//! `MoveElement`. Mirrors `MoveElementCommand`
//! (`lib/commands/timeline/element/move-elements.ts`).
//!
//! `create_track` builds a track whose id is `target_track_id` (no id is
//! consumed). Where TS throws (unknown source, unknown target, incompatible
//! track) the op returns a typed error.

use serde_json::Value;

use super::elements::{element_id, set_track_elements, track_elements};
use super::insert::element_type;
use super::lookup::{element_not_found, track_not_found};
use super::{Applied, CreateTrack};
use crate::animation_split::js_num;
use crate::error::TimelineError;
use crate::model::{SceneTracks, Ticks, TimelineTrack};
use crate::placement::{
    TrackType, audio_insert_index, build_empty_overlay_track, build_empty_track,
    enforce_main_track_start, ordered_tracks, validate_element_track_compatibility,
};

/// `insertTrackAtDisplayIndex`.
fn insert_track(tracks: &mut SceneTracks, id: &str, create: &CreateTrack) -> bool {
    if create.track_type == TrackType::Audio {
        let TimelineTrack::Audio(track) = build_empty_track(id, TrackType::Audio, None) else {
            return false;
        };
        let at = audio_insert_index(tracks, create.index);
        tracks.audio.insert(at, track);
        return true;
    }
    let Some(track) = build_empty_overlay_track(id, create.track_type, None) else {
        return false;
    };
    let at = create.index.min(tracks.overlay.len());
    tracks.overlay.insert(at, track);
    true
}

pub(super) fn move_element(
    tracks: &mut SceneTracks,
    source_track_id: &str,
    target_track_id: &str,
    moved_id: &str,
    new_start_time: Ticks,
    create_track: Option<&CreateTrack>,
) -> Result<Applied, TimelineError> {
    let Some(source_elements) = track_elements(tracks, source_track_id) else {
        return Err(track_not_found(tracks, source_track_id, None));
    };
    let Some(element) = source_elements
        .iter()
        .find(|element| element_id(element) == Some(moved_id))
        .cloned()
    else {
        return Err(element_not_found(tracks, Some(source_track_id), moved_id));
    };

    let mut working = tracks.clone();
    let existing_type = ordered_tracks(&working)
        .into_iter()
        .find(|view| view.id == target_track_id)
        .map(|view| view.track_type);
    let target_type = match (existing_type, create_track) {
        (Some(track_type), _) => track_type,
        (None, Some(create)) => {
            if !insert_track(&mut working, target_track_id, create) {
                return Err(TimelineError::new(
                    "invalid_track",
                    format!("cannot create a {:?} track", create.track_type),
                )
                .with_hint("createTrack.type must be video, text, audio, graphic or effect"));
            }
            create.track_type
        }
        (None, None) => return Err(track_not_found(tracks, target_track_id, None)),
    };

    let Some(kind) = element
        .get("type")
        .and_then(Value::as_str)
        .and_then(element_type)
    else {
        return Err(
            TimelineError::new("invalid_element", "element has an unknown type")
                .with_hint("the element's type must be one of the known element types"),
        );
    };
    if let Err(message) = validate_element_track_compatibility(kind, target_type) {
        let wanted = crate::placement::track_type_for_element_type(kind);
        return Err(TimelineError::incompatible_track(
            message,
            format!(
                "move it to a {} track; valid ids: {}",
                super::track_type_name(wanted),
                super::lookup::track_ids(tracks, Some(wanted))
            ),
        ));
    }

    let adjusted =
        enforce_main_track_start(&working, target_track_id, new_start_time, Some(moved_id));
    let mut moved = element;
    if let Some(map) = moved.as_object_mut() {
        map.insert("startTime".into(), js_num(adjusted.0));
    }

    if source_track_id == target_track_id {
        let elements = track_elements(&working, source_track_id)
            .unwrap_or_default()
            .into_iter()
            .map(|element| {
                if element_id(&element) == Some(moved_id) {
                    moved.clone()
                } else {
                    element
                }
            })
            .collect();
        set_track_elements(&mut working, source_track_id, elements)?;
    } else {
        let remaining = track_elements(&working, source_track_id)
            .unwrap_or_default()
            .into_iter()
            .filter(|element| element_id(element) != Some(moved_id))
            .collect();
        set_track_elements(&mut working, source_track_id, remaining)?;
        let mut target_elements = track_elements(&working, target_track_id).unwrap_or_default();
        target_elements.push(moved);
        set_track_elements(&mut working, target_track_id, target_elements)?;
    }

    *tracks = working;
    Ok(Applied::summary(format!(
        "moved element {moved_id} to track {target_track_id}"
    )))
}
