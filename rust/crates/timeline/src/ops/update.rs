//! `UpdateElements`. Mirrors `UpdateElementsCommand`
//! (`lib/commands/timeline/element/update-elements.ts`) and the update
//! pipeline it runs patches through (`lib/timeline/update-pipeline.ts`).
//!
//! Trim and retime are `UpdateElements` patches too (`ops::trim`,
//! `ops::retime`), so they share this derive/enforce pipeline.

use serde_json::{Map, Value};

use super::elements::{element_id, num, set_track_elements, track_elements};
use super::{Applied, ElementUpdate, IdSource};
use crate::animation_split::{clamp_animations_to_duration, is_truthy, js_max, js_num};
use crate::error::TimelineError;
use crate::model::{RetimeConfig, SceneTracks, Ticks};
use crate::placement::earliest_main_track_element;
use crate::retime::{
    clamp_retime_rate, source_span_at_clip_time, timeline_duration_for_source_span,
};

fn is_retimable(element: &Map<String, Value>) -> bool {
    matches!(
        element.get("type").and_then(Value::as_str),
        Some("video" | "audio")
    )
}

fn retime_config(value: Option<&Value>) -> Option<RetimeConfig> {
    value.and_then(|value| serde_json::from_value(value.clone()).ok())
}

/// The `retime` derive rule: re-clamps the rate and recomputes the duration
/// from the visible source span.
fn derive_retime(
    element: &mut Map<String, Value>,
    original: &Map<String, Value>,
    patch: &Map<String, Value>,
    changed: &mut Vec<String>,
) {
    if !patch.contains_key("retime") || !is_retimable(element) {
        return;
    }

    let next_retime: Option<Value> = match patch.get("retime") {
        Some(value) if is_truthy(Some(value)) => {
            let mut retime = value.as_object().cloned().unwrap_or_default();
            let rate = retime
                .get("rate")
                .and_then(Value::as_f64)
                .unwrap_or(f64::NAN);
            retime.insert("rate".into(), js_num(clamp_retime_rate(rate)));
            Some(Value::Object(retime))
        }
        _ => None,
    };

    let source_duration = match original
        .get("sourceDuration")
        .and_then(Value::as_f64)
        .filter(|_| is_retimable(original))
    {
        Some(source_duration) => source_duration,
        None => {
            let original_retime = if is_retimable(original) {
                retime_config(original.get("retime"))
            } else {
                None
            };
            num(original, "trimStart")
                + source_span_at_clip_time(
                    Ticks(num(original, "duration")),
                    original_retime.as_ref(),
                )
                .0
                + num(original, "trimEnd")
        }
    };
    let visible_source_span = js_max(
        0.0,
        source_duration - num(element, "trimStart") - num(element, "trimEnd"),
    );
    let next_duration = timeline_duration_for_source_span(
        Ticks(visible_source_span),
        retime_config(next_retime.as_ref()).as_ref(),
    );

    match next_retime {
        Some(retime) => {
            element.insert("retime".into(), retime);
        }
        None => {
            element.shift_remove("retime");
        }
    }
    element.insert("duration".into(), js_num(next_duration.0));
    changed.push("retime".into());
    changed.push("duration".into());
}

/// `applyElementUpdate`: spread the patch, run the derive rules, then the
/// enforce rules.
pub(crate) fn apply_element_update(
    original: &Map<String, Value>,
    patch: &Map<String, Value>,
    tracks: &SceneTracks,
    track_id: &str,
    ids: &mut IdSource,
) -> Result<Map<String, Value>, TimelineError> {
    let mut element = original.clone();
    for (key, value) in patch {
        // A TS patch key set to `undefined` drops the field (spread, then
        // JSON); the wasm adapter sends it as `null`, so `null` removes it.
        if value.is_null() {
            element.shift_remove(key);
        } else {
            element.insert(key.clone(), value.clone());
        }
    }
    let mut changed: Vec<String> = patch.keys().cloned().collect();

    derive_retime(&mut element, original, patch, &mut changed);

    if changed.iter().any(|field| field == "duration") {
        let animations = clamp_animations_to_duration(
            element.get("animations"),
            num(&element, "duration"),
            ids,
        )?;
        match animations {
            Some(animations) => {
                element.insert("animations".into(), animations);
            }
            None => {
                element.shift_remove("animations");
            }
        }
    }

    if changed.iter().any(|field| field == "startTime") {
        let requested = js_max(0.0, num(&element, "startTime"));
        let start_time = if track_id != tracks.main.id {
            requested
        } else {
            let id = element.get("id").and_then(Value::as_str);
            match earliest_main_track_element(&tracks.main, id) {
                Some(earliest) if requested > earliest_start(earliest) => requested,
                _ => 0.0,
            }
        };
        element.insert("startTime".into(), js_num(start_time));
    }
    Ok(element)
}

fn earliest_start(element: &crate::model::VideoTrackElement) -> f64 {
    match element {
        crate::model::VideoTrackElement::Video(e) => e.start_time.0,
        crate::model::VideoTrackElement::Image(e) => e.start_time.0,
    }
}

fn immutable(field: &str) -> TimelineError {
    TimelineError::new(
        "immutable_field",
        format!("element field {field} cannot be changed by an update"),
    )
    .with_hint(
        "remove id and type from the patch; delete and re-insert to change an element's type",
    )
}

pub(super) fn update(
    tracks: &mut SceneTracks,
    updates: &[ElementUpdate],
    ids: &mut IdSource,
) -> Result<Applied, TimelineError> {
    for entry in updates {
        let patch = entry.patch.as_object().ok_or_else(|| {
            TimelineError::new("invalid_patch", "an element patch must be an object")
                .with_hint("pass the fields to change as an object")
        })?;
        for field in ["id", "type"] {
            if patch.contains_key(field) {
                return Err(immutable(field));
            }
        }
    }

    let mut updated = 0;
    for entry in updates {
        // TS skips unknown tracks and elements; the agent contract reports them.
        super::lookup::require_element(tracks, &entry.track_id, &entry.element_id)?;
        let Some(mut elements) = track_elements(tracks, &entry.track_id) else {
            return Err(super::lookup::track_not_found(
                tracks,
                &entry.track_id,
                None,
            ));
        };
        let Some(current) = elements
            .iter()
            .find(|element| element_id(element) == Some(&entry.element_id))
            .and_then(Value::as_object)
            .cloned()
        else {
            return Err(super::lookup::element_not_found(
                tracks,
                Some(&entry.track_id),
                &entry.element_id,
            ));
        };
        let Some(patch) = entry.patch.as_object() else {
            return Err(
                TimelineError::new("invalid_patch", "an element patch must be an object")
                    .with_hint("pass the fields to change as an object"),
            );
        };
        let next = Value::Object(apply_element_update(
            &current,
            patch,
            tracks,
            &entry.track_id,
            ids,
        )?);
        for element in elements.iter_mut() {
            if element_id(element) == Some(&entry.element_id) {
                *element = next.clone();
            }
        }
        set_track_elements(tracks, &entry.track_id, elements)?;
        updated += 1;
    }
    Ok(Applied::summary(format!("updated {updated} element(s)")))
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use crate::{ApplyOpOptions, SceneTracks, apply_op};

    fn scene() -> SceneTracks {
        serde_json::from_value(json!({
            "overlay": [],
            "main": {"id": "main", "name": "Main Track", "type": "video", "muted": false,
                     "hidden": false, "elements": [{
                "type": "video", "id": "el-1", "mediaId": "m", "name": "c", "duration": 1000,
                "startTime": 0, "trimStart": 0, "trimEnd": 0, "sourceDuration": 1000,
                "muted": false, "isSourceAudioEnabled": true, "hidden": false,
                "transform": {"scaleX": 1, "scaleY": 1, "position": {"x": 0, "y": 0}, "rotate": 0},
                "opacity": 1, "blendMode": "normal", "volume": 0}]},
            "audio": []
        }))
        .unwrap()
    }

    fn run(patch: serde_json::Value, track: &str, element: &str) -> crate::OpOutput {
        apply_op(ApplyOpOptions {
            tracks: scene(),
            op: serde_json::from_value(json!({"type": "updateElements", "updates": [
                {"trackId": track, "elementId": element, "patch": patch}]}))
            .unwrap(),
            new_ids: vec![],
            ripple: false,
            validate: true,
        })
        .unwrap()
    }

    #[test]
    fn id_and_type_are_immutable() {
        for field in ["id", "type"] {
            let result = apply_op(ApplyOpOptions {
                tracks: scene(),
                op: serde_json::from_value(json!({"type": "updateElements", "updates": [
                    {"trackId": "main", "elementId": "el-1", "patch": {field: "x"}}]}))
                .unwrap(),
                new_ids: vec![],
                ripple: false,
                validate: true,
            });
            assert_eq!(result.unwrap_err().code, "immutable_field");
        }
    }

    #[test]
    fn unknown_ids_are_typed_errors() {
        let run_err = |track: &str, element: &str| {
            apply_op(ApplyOpOptions {
                tracks: scene(),
                op: serde_json::from_value(json!({"type": "updateElements", "updates": [
                    {"trackId": track, "elementId": element, "patch": {"opacity": 0}}]}))
                .unwrap(),
                new_ids: vec![],
                ripple: false,
                validate: true,
            })
            .unwrap_err()
        };
        assert_eq!(run_err("main", "nope").code, "element_not_found");
        assert_eq!(run_err("nope", "el-1").code, "track_not_found");
        assert!(run(json!({"opacity": 0}), "main", "el-1").changed);
    }

    #[test]
    fn null_patch_value_removes_the_key() {
        let output = run(json!({"blendMode": null, "retime": {"rate": 2}}), "main", "el-1");
        let value = serde_json::to_value(&output.tracks).unwrap();
        let element = &value["main"]["elements"][0];
        assert!(element.get("blendMode").is_none());
        assert_eq!(element["retime"]["rate"], 2);

        let cleared = apply_op(ApplyOpOptions {
            tracks: output.tracks,
            op: serde_json::from_value(json!({"type": "updateElements", "updates": [
                {"trackId": "main", "elementId": "el-1", "patch": {"retime": null}}]}))
            .unwrap(),
            new_ids: vec![],
            ripple: false,
            validate: true,
        })
        .unwrap();
        let value = serde_json::to_value(&cleared.tracks).unwrap();
        let element = &value["main"]["elements"][0];
        assert!(element.get("retime").is_none());
        assert_eq!(element["duration"], 1000);
    }

    #[test]
    fn retime_recomputes_duration() {
        let output = run(json!({"retime": {"rate": 2}}), "main", "el-1");
        let value = serde_json::to_value(&output.tracks).unwrap();
        assert_eq!(value["main"]["elements"][0]["duration"], 500);
    }
}
