//! Keyframe splitting. A literal port of `splitAnimationsAtTime` and the
//! helpers it calls in `apps/web/src/lib/animation/{keyframes,interpolation,
//! bezier}.ts`, working on the opaque `animations` JSON (shapes in
//! `lib/animation/types.ts`).
//!
//! Parity notes:
//! - All math is f64 in the same operation order as TS; nothing is rounded.
//! - TS `undefined` fields become absent keys, never `null`.
//! - Object key order follows insertion order (serde_json `preserve_order`),
//!   matching `Object.entries`, so boundary ids are consumed in the same order.
//! - Quirks are kept, e.g. the bezier branch lists the segment's left key twice
//!   on the left side.

use serde_json::{Map, Value};

use crate::error::TimelineError;
use crate::ops::IdSource;

type Object = Map<String, Value>;

const BEZIER_SOLVE_ITERATIONS: usize = 20;

/// A number as `JSON.stringify` writes it: integral values without a fraction.
pub(crate) fn js_num(value: f64) -> Value {
    if value.is_finite() && value.fract() == 0.0 && value.abs() < 9_007_199_254_740_992.0 {
        Value::from(value as i64)
    } else {
        serde_json::Number::from_f64(value).map_or(Value::Null, Value::Number)
    }
}

/// `Math.max` (NaN-propagating).
fn js_max(a: f64, b: f64) -> f64 {
    if a.is_nan() || b.is_nan() {
        f64::NAN
    } else {
        a.max(b)
    }
}

/// `Math.min` (NaN-propagating).
fn js_min(a: f64, b: f64) -> f64 {
    if a.is_nan() || b.is_nan() {
        f64::NAN
    } else {
        a.min(b)
    }
}

fn num(value: Option<&Value>) -> f64 {
    value.and_then(Value::as_f64).unwrap_or(f64::NAN)
}

fn time_of(key: &Object) -> f64 {
    num(key.get("time"))
}

fn value_of(key: &Object) -> f64 {
    num(key.get("value"))
}

/// `value ?? undefined`: absent or `null` is nullish.
fn present<'a>(object: &'a Object, field: &str) -> Option<&'a Value> {
    object.get(field).filter(|value| !value.is_null())
}

fn is_truthy(value: Option<&Value>) -> bool {
    match value {
        None | Some(Value::Null) => false,
        Some(Value::Bool(flag)) => *flag,
        Some(Value::Number(number)) => number.as_f64().is_some_and(|n| n != 0.0 && !n.is_nan()),
        Some(Value::String(text)) => !text.is_empty(),
        Some(_) => true,
    }
}

fn keys_of(channel: &Object) -> Vec<Object> {
    channel
        .get("keys")
        .and_then(Value::as_array)
        .map(|keys| {
            keys.iter()
                .map(|key| key.as_object().cloned().unwrap_or_default())
                .collect()
        })
        .unwrap_or_default()
}

fn kind_of(channel: &Object) -> Option<&str> {
    channel.get("kind").and_then(Value::as_str)
}

// ---------------------------------------------------------------------------
// interpolation.ts
// ---------------------------------------------------------------------------

/// Stable sort by `leftTime - rightTime`, like `Array.prototype.sort`.
fn sort_by_time(keys: &mut [Object]) {
    keys.sort_by(|left, right| {
        let diff = time_of(left) - time_of(right);
        diff.partial_cmp(&0.0).unwrap_or(std::cmp::Ordering::Equal)
    });
}

#[derive(Clone, Copy)]
struct Handle {
    dt: f64,
    dv: f64,
}

impl Handle {
    fn read(key: &Object, field: &str) -> Option<Self> {
        let handle = present(key, field)?.as_object();
        Some(Self {
            dt: num(handle.and_then(|h| h.get("dt"))),
            dv: num(handle.and_then(|h| h.get("dv"))),
        })
    }

    fn to_value(self) -> Value {
        let mut object = Object::new();
        object.insert("dt".into(), js_num(self.dt));
        object.insert("dv".into(), js_num(self.dv));
        Value::Object(object)
    }
}

fn normalize_right_handle(key: &Object, left_key: &Object, right_key: &Object) -> Option<Value> {
    let handle = Handle::read(key, "rightHandle")?;
    let span = js_max(1.0, time_of(right_key) - time_of(left_key));
    Some(
        Handle {
            dt: js_min(span, js_max(0.0, handle.dt)),
            dv: handle.dv,
        }
        .to_value(),
    )
}

fn normalize_left_handle(key: &Object, left_key: &Object, right_key: &Object) -> Option<Value> {
    let handle = Handle::read(key, "leftHandle")?;
    let span = js_max(1.0, time_of(right_key) - time_of(left_key));
    Some(
        Handle {
            dt: js_max(-span, js_min(0.0, handle.dt)),
            dv: handle.dv,
        }
        .to_value(),
    )
}

fn set_or_remove(object: &mut Object, field: &str, value: Option<Value>) {
    match value {
        Some(value) => {
            object.insert(field.into(), value);
        }
        None => {
            object.shift_remove(field);
        }
    }
}

fn normalize_scalar_key(mut key: Object) -> Object {
    if present(&key, "tangentMode").is_none() {
        key.insert("tangentMode".into(), "flat".into());
    }
    if present(&key, "segmentToNext").is_none() {
        key.insert("segmentToNext".into(), "linear".into());
    }
    key
}

/// `normalizeChannel`: sorts keys; scalar keys also get defaults and clamped
/// handles (none on the outer edges).
fn normalize_channel(channel: &Object) -> Object {
    let mut next = channel.clone();
    let mut keys = keys_of(channel);
    if kind_of(channel) == Some("scalar") {
        keys = keys.into_iter().map(normalize_scalar_key).collect();
        sort_by_time(&mut keys);
        let sorted = keys.clone();
        for (index, key) in keys.iter_mut().enumerate() {
            let previous = index.checked_sub(1).map(|i| &sorted[i]);
            let following = sorted.get(index + 1);
            let left = previous.and_then(|previous| normalize_left_handle(key, previous, key));
            let right = following.and_then(|following| normalize_right_handle(key, key, following));
            set_or_remove(key, "leftHandle", left);
            set_or_remove(key, "rightHandle", right);
        }
    } else {
        sort_by_time(&mut keys);
    }
    next.insert(
        "keys".into(),
        Value::Array(keys.into_iter().map(Value::Object).collect()),
    );
    next
}

fn scalar_channel(keys: Vec<Object>, extrapolation: Option<&Value>) -> Object {
    let mut channel = Object::new();
    channel.insert("kind".into(), "scalar".into());
    channel.insert(
        "keys".into(),
        Value::Array(keys.into_iter().map(Value::Object).collect()),
    );
    if let Some(extrapolation) = extrapolation {
        channel.insert("extrapolation".into(), extrapolation.clone());
    }
    channel
}

fn discrete_channel(keys: Vec<Object>) -> Object {
    let mut channel = Object::new();
    channel.insert("kind".into(), "discrete".into());
    channel.insert(
        "keys".into(),
        Value::Array(keys.into_iter().map(Value::Object).collect()),
    );
    channel
}

fn extrapolate_scalar_edge(
    mode: &str,
    edge_key: &Object,
    neighbor_key: Option<&Object>,
    time: f64,
) -> f64 {
    let Some(neighbor_key) = neighbor_key.filter(|_| mode != "hold") else {
        return value_of(edge_key);
    };
    let span = time_of(neighbor_key) - time_of(edge_key);
    if span == 0.0 {
        return value_of(edge_key);
    }
    value_of(edge_key)
        + ((time - time_of(edge_key)) / span) * (value_of(neighbor_key) - value_of(edge_key))
}

fn extrapolation_mode<'a>(channel: &'a Object, side: &str) -> &'a str {
    channel
        .get("extrapolation")
        .and_then(|extrapolation| extrapolation.get(side))
        .and_then(Value::as_str)
        .unwrap_or("hold")
}

fn get_scalar_channel_value_at_time(channel: &Object, time: f64, fallback_value: f64) -> f64 {
    if keys_of(channel).is_empty() {
        return fallback_value;
    }
    let normalized = normalize_channel(channel);
    let keys = keys_of(&normalized);
    let (Some(first_key), Some(last_key)) = (keys.first(), keys.last()) else {
        return fallback_value;
    };

    if time <= time_of(first_key) {
        if time < time_of(first_key) {
            return extrapolate_scalar_edge(
                extrapolation_mode(&normalized, "before"),
                first_key,
                keys.get(1),
                time,
            );
        }
        return value_of(first_key);
    }

    if time >= time_of(last_key) {
        if time > time_of(last_key) {
            return extrapolate_scalar_edge(
                extrapolation_mode(&normalized, "after"),
                last_key,
                keys.len().checked_sub(2).and_then(|i| keys.get(i)),
                time,
            );
        }
        return value_of(last_key);
    }

    for pair in keys.windows(2) {
        let (left_key, right_key) = (&pair[0], &pair[1]);
        if time == time_of(right_key) {
            return value_of(right_key);
        }
        if !(time >= time_of(left_key) && time <= time_of(right_key)) {
            continue;
        }
        let segment = left_key.get("segmentToNext").and_then(Value::as_str);
        if segment == Some("step") {
            return value_of(left_key);
        }
        let span = time_of(right_key) - time_of(left_key);
        if span == 0.0 {
            return value_of(right_key);
        }
        // clamp({ value, min: 0, max: 1 }) = Math.max(0, Math.min(1, value))
        let progress = js_max(0.0, js_min(1.0, (time - time_of(left_key)) / span));
        if segment == Some("linear") {
            return value_of(left_key) + (value_of(right_key) - value_of(left_key)) * progress;
        }

        let curve_progress = solve_bezier_progress_for_time(time, left_key, right_key);
        let right_handle = right_handle_or_default(left_key, right_key);
        let left_handle = left_handle_or_default(left_key, right_key);
        return get_bezier_point(
            curve_progress,
            value_of(left_key),
            value_of(left_key) + right_handle.dv,
            value_of(right_key) + left_handle.dv,
            value_of(right_key),
        );
    }

    value_of(last_key)
}

fn get_discrete_channel_value_at_time(
    channel: &Object,
    time: f64,
    fallback_value: &Value,
) -> Value {
    if keys_of(channel).is_empty() {
        return fallback_value.clone();
    }
    let normalized = normalize_channel(channel);
    let mut current = fallback_value.clone();
    for key in keys_of(&normalized) {
        if time < time_of(&key) {
            break;
        }
        current = key.get("value").cloned().unwrap_or(Value::Null);
    }
    current
}

/// `getChannelValueAtTime`.
fn get_channel_value_at_time(channel: &Object, time: f64, fallback_value: &Value) -> Value {
    if keys_of(channel).is_empty() {
        return fallback_value.clone();
    }
    if kind_of(channel) == Some("scalar") {
        return match fallback_value.as_f64() {
            Some(fallback) => js_num(get_scalar_channel_value_at_time(channel, time, fallback)),
            None => fallback_value.clone(),
        };
    }
    if !(fallback_value.is_string() || fallback_value.is_boolean()) {
        return fallback_value.clone();
    }
    get_discrete_channel_value_at_time(channel, time, fallback_value)
}

/// `getScalarSegmentInterpolation` then `getScalarSegmentType`.
fn segment_type_for_segment(segment: Option<&str>) -> &'static str {
    match segment {
        Some("step") => "step",
        Some("bezier") => "bezier",
        _ => "linear",
    }
}

// ---------------------------------------------------------------------------
// bezier.ts
// ---------------------------------------------------------------------------

fn get_bezier_point(progress: f64, p0: f64, p1: f64, p2: f64, p3: f64) -> f64 {
    let mt = 1.0 - progress;
    mt * mt * mt * p0
        + 3.0 * mt * mt * progress * p1
        + 3.0 * mt * progress * progress * p2
        + progress * progress * progress * p3
}

fn get_default_right_handle(left_key: &Object, right_key: &Object) -> Handle {
    let span = time_of(right_key) - time_of(left_key);
    let value_delta = value_of(right_key) - value_of(left_key);
    Handle {
        dt: span / 3.0,
        dv: value_delta / 3.0,
    }
}

fn get_default_left_handle(left_key: &Object, right_key: &Object) -> Handle {
    let span = time_of(right_key) - time_of(left_key);
    let value_delta = value_of(right_key) - value_of(left_key);
    Handle {
        dt: -span / 3.0,
        dv: -value_delta / 3.0,
    }
}

/// `leftKey.rightHandle ?? getDefaultRightHandle(...)`.
fn right_handle_or_default(left_key: &Object, right_key: &Object) -> Handle {
    Handle::read(left_key, "rightHandle")
        .unwrap_or_else(|| get_default_right_handle(left_key, right_key))
}

/// `rightKey.leftHandle ?? getDefaultLeftHandle(...)`.
fn left_handle_or_default(left_key: &Object, right_key: &Object) -> Handle {
    Handle::read(right_key, "leftHandle")
        .unwrap_or_else(|| get_default_left_handle(left_key, right_key))
}

fn solve_bezier_progress_for_time(time: f64, left_key: &Object, right_key: &Object) -> f64 {
    let mut lower = 0.0;
    let mut upper = 1.0;
    let right_handle = right_handle_or_default(left_key, right_key);
    let left_handle = left_handle_or_default(left_key, right_key);

    for _ in 0..BEZIER_SOLVE_ITERATIONS {
        let mid = (lower + upper) / 2.0;
        let estimate = get_bezier_point(
            mid,
            time_of(left_key),
            time_of(left_key) + right_handle.dt,
            time_of(right_key) + left_handle.dt,
            time_of(right_key),
        );
        if estimate < time {
            lower = mid;
        } else {
            upper = mid;
        }
    }

    (lower + upper) / 2.0
}

// ---------------------------------------------------------------------------
// keyframes.ts
// ---------------------------------------------------------------------------

#[derive(Clone, Copy)]
struct Point {
    x: f64,
    y: f64,
}

fn lerp_point(left: Point, right: Point, progress: f64) -> Point {
    Point {
        x: left.x + (right.x - left.x) * progress,
        y: left.y + (right.y - left.y) * progress,
    }
}

fn shifted(mut key: Object, split_time: f64) -> Object {
    let time = time_of(&key) - split_time;
    key.insert("time".into(), js_num(time));
    key
}

fn create_discrete_key(id: &str, time: f64, value: Value) -> Object {
    let mut key = Object::new();
    key.insert("id".into(), id.into());
    key.insert("time".into(), js_num(time));
    key.insert("value".into(), value);
    key
}

/// `createScalarKey` without a `previousKey`.
fn create_scalar_key(id: &str, time: f64, value: Value, segment_to_next: &str) -> Object {
    let mut key = Object::new();
    key.insert("id".into(), id.into());
    key.insert("time".into(), js_num(time));
    key.insert("value".into(), value);
    key.insert("segmentToNext".into(), segment_to_next.into());
    key.insert("tangentMode".into(), "flat".into());
    key
}

type SplitChannels = (Option<Object>, Option<Object>);

fn split_discrete_channel_at_time(
    channel: &Object,
    split_time: f64,
    left_boundary_id: &str,
    right_boundary_id: &str,
    should_include_split_boundary: bool,
) -> SplitChannels {
    if keys_of(channel).is_empty() {
        return (None, None);
    }

    let normalized = normalize_channel(channel);
    let keys = keys_of(&normalized);
    let mut left_keys: Vec<Object> = keys
        .iter()
        .filter(|key| time_of(key) <= split_time)
        .cloned()
        .collect();
    let mut right_keys: Vec<Object> = keys
        .iter()
        .filter(|key| time_of(key) >= split_time)
        .map(|key| shifted(key.clone(), split_time))
        .collect();

    if should_include_split_boundary {
        let has_boundary_on_left = left_keys.iter().any(|key| time_of(key) == split_time);
        let has_boundary_on_right = right_keys.iter().any(|key| time_of(key) == 0.0);
        let fallback = keys[0].get("value").cloned().unwrap_or(Value::Null);
        let boundary_value = get_channel_value_at_time(&normalized, split_time, &fallback);
        if !has_boundary_on_left {
            left_keys.push(create_discrete_key(
                left_boundary_id,
                split_time,
                boundary_value.clone(),
            ));
        }
        if !has_boundary_on_right {
            right_keys.insert(
                0,
                create_discrete_key(right_boundary_id, 0.0, boundary_value),
            );
        }
    }

    (
        (!left_keys.is_empty()).then(|| normalize_channel(&discrete_channel(left_keys))),
        (!right_keys.is_empty()).then(|| normalize_channel(&discrete_channel(right_keys))),
    )
}

fn split_scalar_channel_at_time(
    channel: &Object,
    split_time: f64,
    left_boundary_id: &str,
    right_boundary_id: &str,
    should_include_split_boundary: bool,
) -> SplitChannels {
    if keys_of(channel).is_empty() {
        return (None, None);
    }

    let normalized = normalize_channel(channel);
    let keys = keys_of(&normalized);
    let extrapolation = normalized.get("extrapolation");
    let mut left_keys: Vec<Object> = keys
        .iter()
        .filter(|key| time_of(key) <= split_time)
        .cloned()
        .collect();
    let mut right_keys: Vec<Object> = keys
        .iter()
        .filter(|key| time_of(key) >= split_time)
        .map(|key| shifted(key.clone(), split_time))
        .collect();

    let finish = |keys: Vec<Object>| {
        (!keys.is_empty()).then(|| normalize_channel(&scalar_channel(keys, extrapolation)))
    };

    let has_boundary_on_left = left_keys.iter().any(|key| time_of(key) == split_time);
    let has_boundary_on_right = right_keys.iter().any(|key| time_of(key) == 0.0);
    if !should_include_split_boundary || (has_boundary_on_left && has_boundary_on_right) {
        return (finish(left_keys), finish(right_keys));
    }

    for pair in keys.windows(2) {
        let (left_key, right_key) = (&pair[0], &pair[1]);
        if !(split_time > time_of(left_key) && split_time < time_of(right_key)) {
            continue;
        }

        let boundary_value = get_channel_value_at_time(
            &normalized,
            split_time,
            &left_key.get("value").cloned().unwrap_or(Value::Null),
        );
        let segment_to_next = left_key.get("segmentToNext").and_then(Value::as_str);

        if segment_to_next == Some("bezier") {
            let right_handle = right_handle_or_default(left_key, right_key);
            let left_handle = left_handle_or_default(left_key, right_key);
            let progress = solve_bezier_progress_for_time(split_time, left_key, right_key);
            let p0 = Point {
                x: time_of(left_key),
                y: value_of(left_key),
            };
            let p1 = Point {
                x: time_of(left_key) + right_handle.dt,
                y: value_of(left_key) + right_handle.dv,
            };
            let p2 = Point {
                x: time_of(right_key) + left_handle.dt,
                y: value_of(right_key) + left_handle.dv,
            };
            let p3 = Point {
                x: time_of(right_key),
                y: value_of(right_key),
            };
            let q0 = lerp_point(p0, p1, progress);
            let q1 = lerp_point(p1, p2, progress);
            let q2 = lerp_point(p2, p3, progress);
            let r0 = lerp_point(q0, q1, progress);
            let r1 = lerp_point(q1, q2, progress);
            let split_point = lerp_point(r0, r1, progress);

            let tangent_mode = left_key.get("tangentMode").cloned();
            let mut left_with_handle = left_key.clone();
            left_with_handle.insert(
                "rightHandle".into(),
                Handle {
                    dt: q0.x - p0.x,
                    dv: q0.y - p0.y,
                }
                .to_value(),
            );
            let mut left_boundary = Object::new();
            left_boundary.insert("id".into(), left_boundary_id.into());
            left_boundary.insert("time".into(), js_num(split_time));
            left_boundary.insert("value".into(), boundary_value.clone());
            left_boundary.insert(
                "leftHandle".into(),
                Handle {
                    dt: r0.x - split_point.x,
                    dv: r0.y - split_point.y,
                }
                .to_value(),
            );
            if let Some(segment) = left_key.get("segmentToNext") {
                left_boundary.insert("segmentToNext".into(), segment.clone());
            }
            if let Some(tangent_mode) = &tangent_mode {
                left_boundary.insert("tangentMode".into(), tangent_mode.clone());
            }
            // The filter keeps `leftKey` itself (its time is before the split),
            // so it appears twice, as in TS.
            left_keys = keys
                .iter()
                .filter(|key| time_of(key) < split_time)
                .cloned()
                .chain([left_with_handle, left_boundary])
                .collect();

            let mut right_boundary = Object::new();
            right_boundary.insert("id".into(), right_boundary_id.into());
            right_boundary.insert("time".into(), js_num(0.0));
            right_boundary.insert("value".into(), boundary_value);
            right_boundary.insert(
                "rightHandle".into(),
                Handle {
                    dt: r1.x - split_point.x,
                    dv: r1.y - split_point.y,
                }
                .to_value(),
            );
            right_boundary.insert("segmentToNext".into(), "bezier".into());
            if let Some(tangent_mode) = tangent_mode {
                right_boundary.insert("tangentMode".into(), tangent_mode);
            }
            let mut right_with_handle = shifted(right_key.clone(), split_time);
            right_with_handle.insert(
                "leftHandle".into(),
                Handle {
                    dt: q2.x - p3.x,
                    dv: q2.y - p3.y,
                }
                .to_value(),
            );
            right_keys = [right_boundary, right_with_handle]
                .into_iter()
                .chain(
                    keys.iter()
                        .filter(|key| time_of(key) > time_of(right_key))
                        .map(|key| shifted(key.clone(), split_time)),
                )
                .collect();
        } else {
            left_keys.push(create_scalar_key(
                left_boundary_id,
                split_time,
                boundary_value.clone(),
                "linear",
            ));
            right_keys.insert(
                0,
                create_scalar_key(
                    right_boundary_id,
                    0.0,
                    boundary_value,
                    segment_type_for_segment(segment_to_next),
                ),
            );
        }

        return (
            Some(normalize_channel(&scalar_channel(left_keys, extrapolation))),
            Some(normalize_channel(&scalar_channel(
                right_keys,
                extrapolation,
            ))),
        );
    }

    (finish(left_keys), finish(right_keys))
}

/// `toAnimation`: drops falsy bindings and keyless channels; `None` when
/// either map ends up empty.
fn to_animation(bindings: Object, channels: Object) -> Option<Value> {
    let bindings: Object = bindings
        .into_iter()
        .filter(|(_, binding)| is_truthy(Some(binding)))
        .collect();
    let channels: Object = channels
        .into_iter()
        .filter(|(_, channel)| {
            channel
                .get("keys")
                .and_then(Value::as_array)
                .is_some_and(|keys| !keys.is_empty())
        })
        .collect();
    if bindings.is_empty() || channels.is_empty() {
        return None;
    }
    let mut animations = Object::new();
    animations.insert("bindings".into(), Value::Object(bindings));
    animations.insert("channels".into(), Value::Object(channels));
    Some(Value::Object(animations))
}

/// `splitAnimationsAtTime`. Consumes two ids per (truthy) binding, left
/// boundary then right boundary, before splitting that binding's channels,
/// whether or not a boundary key ends up using them.
pub(crate) fn split_animations_at_time(
    animations: Option<&Value>,
    split_time: f64,
    should_include_split_boundary: bool,
    ids: &mut IdSource,
) -> Result<(Option<Value>, Option<Value>), TimelineError> {
    let Some(animations) = animations.filter(|value| is_truthy(Some(value))) else {
        return Ok((None, None));
    };
    let empty = Object::new();
    let bindings = animations
        .get("bindings")
        .and_then(Value::as_object)
        .unwrap_or(&empty);
    let channels = animations
        .get("channels")
        .and_then(Value::as_object)
        .unwrap_or(&empty);

    let mut left_bindings = Object::new();
    let mut left_channels = Object::new();
    let mut right_bindings = Object::new();
    let mut right_channels = Object::new();

    for (property_path, binding) in bindings {
        if !is_truthy(Some(binding)) {
            continue;
        }

        let left_boundary_id = ids.next()?;
        let right_boundary_id = ids.next()?;
        let mut has_left_keys = false;
        let mut has_right_keys = false;

        let components = binding
            .get("components")
            .and_then(Value::as_array)
            .map(Vec::as_slice)
            .unwrap_or_default();
        for component in components {
            let channel_id = component
                .get("channelId")
                .and_then(Value::as_str)
                .unwrap_or_default();
            let Some(channel) = channels.get(channel_id).and_then(Value::as_object) else {
                continue;
            };
            let split = if kind_of(channel) == Some("discrete") {
                split_discrete_channel_at_time(
                    channel,
                    split_time,
                    &left_boundary_id,
                    &right_boundary_id,
                    should_include_split_boundary,
                )
            } else {
                split_scalar_channel_at_time(
                    channel,
                    split_time,
                    &left_boundary_id,
                    &right_boundary_id,
                    should_include_split_boundary,
                )
            };
            if let Some(left) = split.0 {
                left_channels.insert(channel_id.to_string(), Value::Object(left));
                has_left_keys = true;
            }
            if let Some(right) = split.1 {
                right_channels.insert(channel_id.to_string(), Value::Object(right));
                has_right_keys = true;
            }
        }

        if has_left_keys {
            left_bindings.insert(property_path.clone(), binding.clone());
        }
        if has_right_keys {
            right_bindings.insert(property_path.clone(), binding.clone());
        }
    }

    Ok((
        to_animation(left_bindings, left_channels),
        to_animation(right_bindings, right_channels),
    ))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn ids(list: &[&str]) -> IdSource {
        IdSource::new(list.iter().map(|id| id.to_string()).collect())
    }

    #[test]
    fn js_num_writes_integers_without_fraction() {
        assert_eq!(js_num(3.0), json!(3));
        assert_eq!(js_num(-0.0), json!(0));
        assert_eq!(js_num(0.5), json!(0.5));
    }

    #[test]
    fn no_animations_consumes_no_ids() {
        let mut source = ids(&[]);
        assert_eq!(
            split_animations_at_time(None, 10.0, true, &mut source).unwrap(),
            (None, None)
        );
    }

    #[test]
    fn linear_channel_gets_boundary_keys_on_both_sides() {
        let animations = json!({
            "bindings": {"opacity": {"path": "opacity", "kind": "number",
                "components": [{"key": "value", "channelId": "opacity:value"}]}},
            "channels": {"opacity:value": {"kind": "scalar", "keys": [
                {"id": "a", "time": 0, "value": 0, "segmentToNext": "linear", "tangentMode": "flat"},
                {"id": "b", "time": 100, "value": 1, "segmentToNext": "linear", "tangentMode": "flat"}
            ]}}
        });
        let mut source = ids(&["l", "r"]);
        let (left, right) =
            split_animations_at_time(Some(&animations), 25.0, true, &mut source).unwrap();
        let left = left.unwrap();
        let right = right.unwrap();
        let left_keys = &left["channels"]["opacity:value"]["keys"];
        let right_keys = &right["channels"]["opacity:value"]["keys"];
        assert_eq!(left_keys[1]["id"], "l");
        assert_eq!(left_keys[1]["time"], json!(25));
        assert_eq!(left_keys[1]["value"], json!(0.25));
        assert_eq!(right_keys[0]["id"], "r");
        assert_eq!(right_keys[0]["time"], json!(0));
        assert_eq!(right_keys[1]["time"], json!(75));
    }

    #[test]
    fn missing_ids_error() {
        let animations = json!({
            "bindings": {"opacity": {"components": []}},
            "channels": {}
        });
        let mut source = ids(&["only-one"]);
        assert!(split_animations_at_time(Some(&animations), 1.0, true, &mut source).is_err());
    }
}
