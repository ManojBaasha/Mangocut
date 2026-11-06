//! Typed "not found" errors whose hints name the valid ids.

use super::track_type_name;
use crate::error::TimelineError;
use crate::model::SceneTracks;
use crate::placement::{TrackType, ordered_tracks};

/// How many ids a hint lists before it trails off.
const HINT_LIMIT: usize = 12;

fn list(ids: Vec<&str>) -> String {
    if ids.is_empty() {
        return "none".to_string();
    }
    let total = ids.len();
    let shown: Vec<&str> = ids.into_iter().take(HINT_LIMIT).collect();
    let more = total - shown.len();
    let mut text = shown.join(", ");
    if more > 0 {
        text.push_str(&format!(" (and {more} more)"));
    }
    text
}

/// Ids of the tracks of `wanted` (all tracks when `None`).
pub(crate) fn track_ids(tracks: &SceneTracks, wanted: Option<TrackType>) -> String {
    list(
        ordered_tracks(tracks)
            .into_iter()
            .filter(|view| wanted.is_none_or(|kind| view.track_type == kind))
            .map(|view| view.id)
            .collect(),
    )
}

pub(crate) fn track_not_found(
    tracks: &SceneTracks,
    track_id: &str,
    wanted: Option<TrackType>,
) -> TimelineError {
    let which = match wanted {
        Some(kind) => format!("valid {} track ids: ", track_type_name(kind)),
        None => "valid track ids: ".to_string(),
    };
    TimelineError::new("track_not_found", format!("track {track_id} not found"))
        .with_hint(format!("{which}{}", track_ids(tracks, wanted)))
}

/// Element not found; when `track_id` is known the hint lists that track's
/// elements, otherwise every element on the timeline.
pub(crate) fn element_not_found(
    tracks: &SceneTracks,
    track_id: Option<&str>,
    element_id: &str,
) -> TimelineError {
    let views = ordered_tracks(tracks);
    let ids: Vec<&str> = views
        .iter()
        .filter(|view| track_id.is_none_or(|id| view.id == id))
        .flat_map(|view| view.elements.iter().map(|span| span.id))
        .collect();
    let place = match track_id {
        Some(id) => format!(" on track {id}"),
        None => String::new(),
    };
    TimelineError::new(
        "element_not_found",
        format!("element {element_id} not found{place}"),
    )
    .with_hint(format!("valid element ids: {}", list(ids)))
}

/// `Ok(())` when `track_id` holds `element_id`; otherwise the typed error.
pub(crate) fn require_element(
    tracks: &SceneTracks,
    track_id: &str,
    element_id: &str,
) -> Result<(), TimelineError> {
    let views = ordered_tracks(tracks);
    match views.iter().find(|view| view.id == track_id) {
        None => Err(track_not_found(tracks, track_id, None)),
        Some(view) if view.elements.iter().any(|span| span.id == element_id) => Ok(()),
        Some(_) => Err(element_not_found(tracks, Some(track_id), element_id)),
    }
}
