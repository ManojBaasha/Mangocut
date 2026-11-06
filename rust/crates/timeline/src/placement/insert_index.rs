use super::{Direction, TrackType};
use crate::model::SceneTracks;

pub fn default_insert_index_for_track(tracks: &SceneTracks, track_type: TrackType) -> usize {
    match track_type {
        TrackType::Audio => tracks.overlay.len() + 1 + tracks.audio.len(),
        TrackType::Effect => 0,
        _ => tracks.overlay.len(),
    }
}

pub fn highest_insert_index_for_track(tracks: &SceneTracks, track_type: TrackType) -> usize {
    match track_type {
        TrackType::Audio => tracks.overlay.len() + 1,
        _ => 0,
    }
}

/// Returns `(insert_index, insert_position)`.
pub fn resolve_preferred_new_track_placement(
    tracks: &SceneTracks,
    track_type: TrackType,
    preferred_index: usize,
    direction: Direction,
) -> (usize, Option<Direction>) {
    let track_count = tracks.overlay.len() + 1 + tracks.audio.len();
    if track_count == 0 {
        return (
            0,
            if track_type == TrackType::Audio {
                Some(Direction::Below)
            } else {
                None
            },
        );
    }

    let safe_preferred_index = preferred_index.min(track_count - 1);
    let main_track_index = tracks.overlay.len();

    if track_type == TrackType::Audio {
        if safe_preferred_index <= main_track_index {
            return (main_track_index + 1, Some(Direction::Below));
        }
        let insert_index = match direction {
            Direction::Above => safe_preferred_index,
            Direction::Below => safe_preferred_index + 1,
        };
        return (insert_index, Some(direction));
    }

    let insert_index = match direction {
        Direction::Above => safe_preferred_index,
        Direction::Below => safe_preferred_index + 1,
    };
    if insert_index > main_track_index {
        return (main_track_index, Some(Direction::Above));
    }
    (insert_index, Some(direction))
}
