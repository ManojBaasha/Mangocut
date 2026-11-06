use super::insert_index::{
    default_insert_index_for_track, highest_insert_index_for_track,
    resolve_preferred_new_track_placement,
};
use super::{
    Direction, NewTrackPosition, PlacementResult, PlacementStrategy, PlacementSubject,
    PlacementTimeSpan, TrackType, TrackView, VerticalDragDirection, can_place_time_spans_on_track,
    enforce_main_track_start, ordered_tracks, track_type_for_element_type,
};
use crate::model::SceneTracks;

fn build_existing_track_result(
    track: &TrackView<'_>,
    track_index: usize,
    tracks: &SceneTracks,
    time_spans: &[PlacementTimeSpan],
) -> PlacementResult {
    let first_span = time_spans.first();
    let requested = first_span.map(|span| span.start_time).unwrap_or_default();
    let adjusted = enforce_main_track_start(
        tracks,
        track.id,
        requested,
        first_span.and_then(|span| span.exclude_element_id.as_deref()),
    );
    PlacementResult::ExistingTrack {
        track_id: track.id.to_string(),
        track_index,
        track_type: track.track_type,
        adjusted_start_time: (adjusted != requested).then_some(adjusted),
    }
}

fn build_new_track_result(
    track_type: TrackType,
    insert_index: usize,
    insert_position: Option<Direction>,
) -> PlacementResult {
    PlacementResult::NewTrack {
        insert_index,
        insert_position,
        track_type,
    }
}

fn find_first_available_track_index(
    tracks: &[TrackView<'_>],
    track_type: TrackType,
    time_spans: &[PlacementTimeSpan],
) -> Option<usize> {
    tracks.iter().position(|track| {
        track.track_type == track_type && can_place_time_spans_on_track(track, time_spans)
    })
}

fn resolve_always_new_track(
    tracks: &SceneTracks,
    track_type: TrackType,
    position: NewTrackPosition,
) -> PlacementResult {
    let insert_index = match position {
        NewTrackPosition::Highest => highest_insert_index_for_track(tracks, track_type),
        NewTrackPosition::Default => default_insert_index_for_track(tracks, track_type),
    };
    build_new_track_result(track_type, insert_index, None)
}

fn insert_direction(
    hover_direction: Direction,
    vertical_drag_direction: Option<VerticalDragDirection>,
) -> Direction {
    match vertical_drag_direction {
        Some(VerticalDragDirection::Up) => Direction::Above,
        Some(VerticalDragDirection::Down) => Direction::Below,
        None => hover_direction,
    }
}

pub fn resolve_track_placement(
    tracks: &SceneTracks,
    subject: PlacementSubject,
    time_spans: &[PlacementTimeSpan],
    strategy: &PlacementStrategy,
) -> Option<PlacementResult> {
    let ordered = ordered_tracks(tracks);
    let track_type = match subject {
        PlacementSubject::TrackType(track_type) => track_type,
        PlacementSubject::ElementType(element_type) => track_type_for_element_type(element_type),
    };

    match strategy {
        PlacementStrategy::Explicit { track_id } => {
            let track_index = ordered.iter().position(|track| track.id == track_id)?;
            let track = &ordered[track_index];
            if track.track_type != track_type {
                return None;
            }
            Some(build_existing_track_result(
                track,
                track_index,
                tracks,
                time_spans,
            ))
        }
        PlacementStrategy::FirstAvailable => {
            if let Some(index) = find_first_available_track_index(&ordered, track_type, time_spans)
            {
                return Some(build_existing_track_result(
                    &ordered[index],
                    index,
                    tracks,
                    time_spans,
                ));
            }
            Some(resolve_always_new_track(
                tracks,
                track_type,
                NewTrackPosition::Highest,
            ))
        }
        PlacementStrategy::PreferIndex {
            track_index,
            hover_direction,
            vertical_drag_direction,
            create_new_track_only,
        } => {
            let preferred = ordered.get(*track_index);
            let is_compatible = preferred.is_some_and(|track| track.track_type == track_type);
            if let Some(track) = preferred
                && !create_new_track_only
                && is_compatible
                && can_place_time_spans_on_track(track, time_spans)
            {
                return Some(build_existing_track_result(
                    track,
                    *track_index,
                    tracks,
                    time_spans,
                ));
            }

            let (insert_index, insert_position) = resolve_preferred_new_track_placement(
                tracks,
                track_type,
                *track_index,
                insert_direction(
                    *hover_direction,
                    if is_compatible {
                        None
                    } else {
                        *vertical_drag_direction
                    },
                ),
            );
            Some(build_new_track_result(
                track_type,
                insert_index,
                insert_position,
            ))
        }
        PlacementStrategy::AboveSource { source_track_index } => {
            if let Some(above_index) = source_track_index.checked_sub(1)
                && let Some(above) = ordered.get(above_index)
                && above.track_type == track_type
                && can_place_time_spans_on_track(above, time_spans)
            {
                return Some(build_existing_track_result(
                    above,
                    above_index,
                    tracks,
                    time_spans,
                ));
            }

            if let Some(index) = find_first_available_track_index(&ordered, track_type, time_spans)
            {
                return Some(build_existing_track_result(
                    &ordered[index],
                    index,
                    tracks,
                    time_spans,
                ));
            }

            Some(build_new_track_result(
                track_type,
                highest_insert_index_for_track(tracks, track_type),
                None,
            ))
        }
        PlacementStrategy::AlwaysNew { position } => {
            Some(resolve_always_new_track(tracks, track_type, *position))
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::{Ticks, VideoTrack};
    use crate::placement::{ElementType, build_empty_overlay_track};

    fn tracks() -> SceneTracks {
        let main: VideoTrack = serde_json::from_value(serde_json::json!({
            "id": "main", "name": "Main Track", "type": "video",
            "elements": [], "muted": false, "hidden": false
        }))
        .unwrap();
        SceneTracks {
            overlay: vec![
                build_empty_overlay_track("t1", TrackType::Text, None).unwrap(),
                build_empty_overlay_track("v1", TrackType::Video, None).unwrap(),
            ],
            main,
            audio: Vec::new(),
            extra: Default::default(),
        }
    }

    fn span(start: f64, duration: f64) -> PlacementTimeSpan {
        PlacementTimeSpan {
            start_time: Ticks(start),
            duration: Ticks(duration),
            exclude_element_id: None,
        }
    }

    #[test]
    fn explicit_requires_matching_type() {
        let tracks = tracks();
        let strategy = PlacementStrategy::Explicit {
            track_id: "t1".into(),
        };
        let ok = resolve_track_placement(
            &tracks,
            PlacementSubject::ElementType(ElementType::Text),
            &[span(0.0, 10.0)],
            &strategy,
        );
        assert_eq!(
            ok,
            Some(PlacementResult::ExistingTrack {
                track_id: "t1".into(),
                track_index: 0,
                track_type: TrackType::Text,
                adjusted_start_time: None,
            })
        );
        let wrong = resolve_track_placement(
            &tracks,
            PlacementSubject::ElementType(ElementType::Audio),
            &[span(0.0, 10.0)],
            &strategy,
        );
        assert_eq!(wrong, None);
    }

    #[test]
    fn main_track_start_is_pulled_to_zero_when_empty() {
        let tracks = tracks();
        let result = resolve_track_placement(
            &tracks,
            PlacementSubject::TrackType(TrackType::Video),
            &[span(500.0, 10.0)],
            &PlacementStrategy::Explicit {
                track_id: "main".into(),
            },
        );
        assert_eq!(
            result,
            Some(PlacementResult::ExistingTrack {
                track_id: "main".into(),
                track_index: 2,
                track_type: TrackType::Video,
                adjusted_start_time: Some(Ticks(0.0)),
            })
        );
    }

    #[test]
    fn first_available_falls_back_to_new_track_at_highest_index() {
        let tracks = tracks();
        let result = resolve_track_placement(
            &tracks,
            PlacementSubject::TrackType(TrackType::Audio),
            &[span(0.0, 10.0)],
            &PlacementStrategy::FirstAvailable,
        );
        assert_eq!(
            result,
            Some(PlacementResult::NewTrack {
                insert_index: 3,
                insert_position: None,
                track_type: TrackType::Audio,
            })
        );
    }

    #[test]
    fn prefer_index_creates_track_above_main_for_overlay_types() {
        let tracks = tracks();
        let result = resolve_track_placement(
            &tracks,
            PlacementSubject::TrackType(TrackType::Text),
            &[span(0.0, 10.0)],
            &PlacementStrategy::PreferIndex {
                track_index: 2,
                hover_direction: Direction::Below,
                vertical_drag_direction: None,
                create_new_track_only: false,
            },
        );
        assert_eq!(
            result,
            Some(PlacementResult::NewTrack {
                insert_index: 2,
                insert_position: Some(Direction::Above),
                track_type: TrackType::Text,
            })
        );
    }

    #[test]
    fn apply_placement_inserts_new_audio_track_below_main() {
        let tracks = tracks();
        let placement = PlacementResult::NewTrack {
            insert_index: 3,
            insert_position: None,
            track_type: TrackType::Audio,
        };
        let (updated, id) =
            crate::placement::apply_placement(&tracks, &placement, Vec::new(), None, || {
                Ok("new".to_string())
            })
            .unwrap()
            .unwrap();
        assert_eq!(id, "new");
        assert_eq!(updated.audio.len(), 1);
        assert_eq!(updated.audio[0].id, "new");
    }
}
