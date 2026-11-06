//! JSON-level access to a track's elements, shared by the element ops.
//!
//! Ops that rewrite arbitrary element fields (update, move, ripple) read a
//! track's elements as JSON, change them like the TS spread does, and write
//! them back through the typed model, which validates the result.

use serde::Serialize;
use serde::de::DeserializeOwned;
use serde_json::Value;

use crate::error::TimelineError;
use crate::model::{OverlayTrack, SceneTracks};
use crate::placement::overlay_id;

fn to_values<T: Serialize>(elements: &[T]) -> Vec<Value> {
    // Serializing derived structs to `Value` cannot fail; a failure would
    // surface as `Null`, which `from_values` then rejects as malformed.
    elements
        .iter()
        .map(|element| serde_json::to_value(element).unwrap_or(Value::Null))
        .collect()
}

fn from_values<T: DeserializeOwned>(values: Vec<Value>) -> Result<Vec<T>, TimelineError> {
    values
        .into_iter()
        .map(|value| {
            serde_json::from_value(value).map_err(|error| {
                TimelineError::new("invalid_element", format!("element is malformed: {error}"))
                    .with_hint("check the field types of the element patch")
            })
        })
        .collect()
}

/// `findTrackInSceneTracks` (main, then overlay, then audio), as JSON.
pub(crate) fn track_elements(tracks: &SceneTracks, track_id: &str) -> Option<Vec<Value>> {
    if tracks.main.id == track_id {
        return Some(to_values(&tracks.main.elements));
    }
    if let Some(track) = tracks
        .overlay
        .iter()
        .find(|track| overlay_id(track) == track_id)
    {
        return Some(match track {
            OverlayTrack::Video(t) => to_values(&t.elements),
            OverlayTrack::Text(t) => to_values(&t.elements),
            OverlayTrack::Graphic(t) => to_values(&t.elements),
            OverlayTrack::Effect(t) => to_values(&t.elements),
        });
    }
    tracks
        .audio
        .iter()
        .find(|track| track.id == track_id)
        .map(|track| to_values(&track.elements))
}

/// Replaces a track's elements. `Ok(false)` when the track does not exist.
pub(crate) fn set_track_elements(
    tracks: &mut SceneTracks,
    track_id: &str,
    values: Vec<Value>,
) -> Result<bool, TimelineError> {
    if tracks.main.id == track_id {
        tracks.main.elements = from_values(values)?;
        return Ok(true);
    }
    if let Some(track) = tracks
        .overlay
        .iter_mut()
        .find(|track| overlay_id(track) == track_id)
    {
        match track {
            OverlayTrack::Video(t) => t.elements = from_values(values)?,
            OverlayTrack::Text(t) => t.elements = from_values(values)?,
            OverlayTrack::Graphic(t) => t.elements = from_values(values)?,
            OverlayTrack::Effect(t) => t.elements = from_values(values)?,
        }
        return Ok(true);
    }
    if let Some(track) = tracks.audio.iter_mut().find(|track| track.id == track_id) {
        track.elements = from_values(values)?;
        return Ok(true);
    }
    Ok(false)
}

pub(crate) fn element_id(element: &Value) -> Option<&str> {
    element.get("id").and_then(Value::as_str)
}

/// Ids of every track in `[...overlay, main, ...audio]` order.
pub(crate) fn ordered_track_ids(tracks: &SceneTracks) -> Vec<String> {
    crate::placement::ordered_tracks(tracks)
        .into_iter()
        .map(|view| view.id.to_string())
        .collect()
}

/// A number field as JS would read it (`NaN` when absent or not a number).
pub(crate) fn num(element: &serde_json::Map<String, Value>, key: &str) -> f64 {
    element.get(key).and_then(Value::as_f64).unwrap_or(f64::NAN)
}
