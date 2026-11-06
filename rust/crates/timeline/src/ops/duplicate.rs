//! `DuplicateElements`. Mirrors `DuplicateElementsCommand`
//! (`lib/commands/timeline/element/duplicate-elements.ts`).
//!
//! Tracks are visited in `[overlay, main, audio]` order. For each track with
//! targets: one id per duplicated element (in track order, each followed by its
//! regenerated keyframe ids), then one id for the new track the copies go on.

use serde_json::Value;

use super::elements::{element_id, ordered_track_ids, track_elements};
use super::{Applied, IdSource};
use crate::animation_split::clone_animations;
use crate::error::TimelineError;
use crate::model::{ElementRef, SceneTracks, TimelineElement};
use crate::placement::{
    NewTrackPosition, PlacementResult, PlacementStrategy, PlacementSubject, apply_placement,
    ordered_tracks, resolve_track_placement,
};

pub(super) fn duplicate(
    tracks: &mut SceneTracks,
    targets: &[ElementRef],
    ids: &mut IdSource,
) -> Result<Applied, TimelineError> {
    let original = tracks.clone();
    let track_types: Vec<_> = ordered_tracks(&original)
        .into_iter()
        .map(|view| view.track_type)
        .collect();
    let mut updated = original.clone();
    let mut created: Vec<ElementRef> = Vec::new();

    for (track_id, track_type) in ordered_track_ids(&original).into_iter().zip(track_types) {
        let wanted: Vec<&str> = targets
            .iter()
            .filter(|target| target.track_id == track_id)
            .map(|target| target.element_id.as_str())
            .collect();
        if wanted.is_empty() {
            continue;
        }

        let mut copies: Vec<TimelineElement> = Vec::new();
        for element in track_elements(&original, &track_id).unwrap_or_default() {
            if !element_id(&element).is_some_and(|id| wanted.contains(&id)) {
                continue;
            }
            let new_id = ids.next()?;
            copies.push(build_duplicate(element, &new_id, ids)?);
        }
        let new_ids: Vec<String> = copies.iter().map(element_id_of).collect();

        let Some(placement) = resolve_track_placement(
            &updated,
            PlacementSubject::TrackType(track_type),
            &[],
            &PlacementStrategy::AlwaysNew {
                position: NewTrackPosition::Highest,
            },
        ) else {
            continue;
        };
        if !matches!(placement, PlacementResult::NewTrack { .. }) {
            continue;
        }
        let Some((next, target_track_id)) =
            apply_placement(&updated, &placement, copies, None, || ids.next())?
        else {
            continue;
        };
        updated = next;
        for element_id in new_ids {
            created.push(ElementRef {
                track_id: target_track_id.clone(),
                element_id,
                extra: Default::default(),
            });
        }
    }

    *tracks = updated;
    Ok(Applied {
        select: created.clone(),
        summary: format!("duplicated {} element(s)", created.len()),
        created,
    })
}

fn element_id_of(element: &TimelineElement) -> String {
    match element {
        TimelineElement::Audio(e) => e.id.clone(),
        TimelineElement::Video(e) => e.id.clone(),
        TimelineElement::Image(e) => e.id.clone(),
        TimelineElement::Text(e) => e.id.clone(),
        TimelineElement::Sticker(e) => e.id.clone(),
        TimelineElement::Graphic(e) => e.id.clone(),
        TimelineElement::Effect(e) => e.id.clone(),
    }
}

/// `buildDuplicateElement`.
fn build_duplicate(
    element: Value,
    id: &str,
    ids: &mut IdSource,
) -> Result<TimelineElement, TimelineError> {
    let mut map = match element {
        Value::Object(map) => map,
        _ => {
            return Err(TimelineError::new(
                "invalid_element",
                "element is not an object",
            ));
        }
    };
    let name = map
        .get("name")
        .and_then(Value::as_str)
        .unwrap_or("undefined");
    let name = format!("{name} (copy)");
    let animations = clone_animations(map.get("animations"), true, ids)?;
    map.insert("id".into(), Value::String(id.to_string()));
    map.insert("name".into(), Value::String(name));
    match animations {
        Some(animations) => {
            map.insert("animations".into(), animations);
        }
        None => {
            map.shift_remove("animations");
        }
    }
    serde_json::from_value(Value::Object(map)).map_err(|error| {
        TimelineError::new("invalid_element", format!("element is malformed: {error}"))
    })
}
