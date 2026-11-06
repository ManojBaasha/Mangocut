//! `TrimElement`. Mirrors `TimelineManager.updateElementTrim`
//! (`core/managers/timeline-manager.ts`): an `UpdateElements` patch on the
//! element's track; an unknown element id is a silent no-op.

use serde_json::{Map, Value};

use super::update::update;
use super::{Applied, ElementUpdate, IdSource};
use crate::animation_split::js_num;
use crate::error::TimelineError;
use crate::model::{SceneTracks, Ticks};
use crate::placement::ordered_tracks;

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
        return Ok(Applied::summary(format!("element {element_id} not found")));
    };

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
