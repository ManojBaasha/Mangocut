//! `RetimeElement`. Mirrors `TimelineManager.updateElementRetime`: an
//! `UpdateElements` patch of `{ retime }` (absent/null clears it); the update
//! pipeline recomputes the duration.

use serde_json::{Map, Value};

use super::update::update;
use super::{Applied, ElementUpdate, IdSource};
use crate::error::TimelineError;
use crate::model::{RetimeConfig, SceneTracks};

pub(super) fn retime(
    tracks: &mut SceneTracks,
    track_id: &str,
    element_id: &str,
    retime: Option<&RetimeConfig>,
    ids: &mut IdSource,
) -> Result<Applied, TimelineError> {
    let mut patch = Map::new();
    patch.insert(
        "retime".into(),
        match retime {
            Some(retime) => serde_json::to_value(retime).expect("retime serializes"),
            None => Value::Null,
        },
    );
    update(
        tracks,
        &[ElementUpdate {
            track_id: track_id.to_string(),
            element_id: element_id.to_string(),
            patch: Value::Object(patch),
        }],
        ids,
    )?;
    Ok(Applied::summary(format!("retimed element {element_id}")))
}
