//! `TrimElement`. Mirrors `TimelineManager.updateElementTrim`
//! (`core/managers/timeline-manager.ts`): an `UpdateElements` patch on the
//! element's track (TS no-ops on an unknown id; this reports it).

use serde_json::{Map, Value};

use super::elements::{element_id as element_id_of, track_elements};
use super::update::update;
use super::{Applied, ElementUpdate, IdSource};
use crate::animation_split::js_num;
use crate::error::TimelineError;
use crate::model::{SceneTracks, Ticks};
use crate::placement::ordered_tracks;

// `!(x < y)` is deliberate: it also rejects NaN.
#[allow(clippy::neg_cmp_op_on_partial_ord)]
pub(super) fn trim(
    tracks: &mut SceneTracks,
    element_id: &str,
    trim_start: Ticks,
    trim_end: Ticks,
    start_time: Option<Ticks>,
    duration: Option<Ticks>,
    ids: &mut IdSource,
) -> Result<Applied, TimelineError> {
    let Some(track_id) = ordered_tracks(tracks)
        .into_iter()
        .find(|view| view.elements.iter().any(|span| span.id == element_id))
        .map(|view| view.id.to_string())
    else {
        return Err(super::lookup::element_not_found(tracks, None, element_id));
    };

    let source_duration = track_elements(tracks, &track_id)
        .unwrap_or_default()
        .iter()
        .find(|element| element_id_of(element) == Some(element_id))
        .and_then(|element| element.get("sourceDuration"))
        .and_then(Value::as_f64);
    let limit = match source_duration {
        Some(source) => format!(
            "trimStart and trimEnd must be at least 0 and add up to less than the source duration {source} ticks"
        ),
        None => "trimStart and trimEnd must be finite and at least 0".to_string(),
    };
    let invalid = |what: String| TimelineError::invalid_trim(what, limit.clone());
    if !(trim_start.0 >= 0.0 && trim_start.0.is_finite()) {
        return Err(invalid(format!(
            "trimStart {} is not a tick count >= 0",
            trim_start.0
        )));
    }
    if !(trim_end.0 >= 0.0 && trim_end.0.is_finite()) {
        return Err(invalid(format!(
            "trimEnd {} is not a tick count >= 0",
            trim_end.0
        )));
    }
    if let Some(source) = source_duration
        && !(trim_start.0 + trim_end.0 < source)
    {
        return Err(invalid(format!(
            "trimming {} ticks leaves nothing of the {source} tick source",
            trim_start.0 + trim_end.0
        )));
    }
    if let Some(duration) = duration
        && !(duration.0 > 0.0 && duration.0.is_finite())
    {
        return Err(invalid(format!(
            "duration {} must be greater than 0",
            duration.0
        )));
    }
    if let Some(start_time) = start_time
        && !start_time.0.is_finite()
    {
        return Err(invalid(format!(
            "startTime {} must be finite",
            start_time.0
        )));
    }

    let mut patch = Map::new();
    patch.insert("trimStart".into(), js_num(trim_start.0));
    patch.insert("trimEnd".into(), js_num(trim_end.0));
    if let Some(start_time) = start_time {
        patch.insert("startTime".into(), js_num(start_time.0));
    }
    if let Some(duration) = duration {
        patch.insert("duration".into(), js_num(duration.0));
    }
    update(
        tracks,
        &[ElementUpdate {
            track_id,
            element_id: element_id.to_string(),
            patch: Value::Object(patch),
        }],
        ids,
    )?;
    Ok(Applied::summary(format!("trimmed element {element_id}")))
}
