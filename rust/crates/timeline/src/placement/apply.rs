use super::track_factory::{build_empty_overlay_track, build_empty_track};
use super::{PlacementResult, TrackType, ordered_tracks};
use crate::error::TimelineError;
use crate::model::{
    AudioElement, EffectElement, GraphicTrackElement, OverlayTrack, SceneTracks, TextElement,
    TimelineElement, TimelineTrack, VideoTrackElement,
};

fn convert_all<T>(
    elements: Vec<TimelineElement>,
    convert: impl Fn(TimelineElement) -> Option<T>,
) -> Option<Vec<T>> {
    elements.into_iter().map(convert).collect()
}

fn to_video(element: TimelineElement) -> Option<VideoTrackElement> {
    match element {
        TimelineElement::Video(e) => Some(VideoTrackElement::Video(e)),
        TimelineElement::Image(e) => Some(VideoTrackElement::Image(e)),
        _ => None,
    }
}

fn to_text(element: TimelineElement) -> Option<TextElement> {
    match element {
        TimelineElement::Text(e) => Some(e),
        _ => None,
    }
}

fn to_audio(element: TimelineElement) -> Option<AudioElement> {
    match element {
        TimelineElement::Audio(e) => Some(e),
        _ => None,
    }
}

fn to_effect(element: TimelineElement) -> Option<EffectElement> {
    match element {
        TimelineElement::Effect(e) => Some(e),
        _ => None,
    }
}

fn to_graphic(element: TimelineElement) -> Option<GraphicTrackElement> {
    match element {
        TimelineElement::Sticker(e) => Some(GraphicTrackElement::Sticker(e)),
        TimelineElement::Graphic(e) => Some(GraphicTrackElement::Graphic(e)),
        _ => None,
    }
}

/// Appends `elements` to the track with `track_id`. `false` when the track is
/// missing or an element's type does not belong on that track (TS casts and
/// trusts its callers; placement validates compatibility first).
pub fn append_elements(
    tracks: &mut SceneTracks,
    track_id: &str,
    elements: Vec<TimelineElement>,
) -> bool {
    if tracks.main.id == track_id {
        return match convert_all(elements, to_video) {
            Some(mut converted) => {
                tracks.main.elements.append(&mut converted);
                true
            }
            None => false,
        };
    }
    if let Some(track) = tracks
        .overlay
        .iter_mut()
        .find(|t| overlay_id(t) == track_id)
    {
        return match track {
            OverlayTrack::Video(t) => convert_all(elements, to_video)
                .map(|mut c| t.elements.append(&mut c))
                .is_some(),
            OverlayTrack::Text(t) => convert_all(elements, to_text)
                .map(|mut c| t.elements.append(&mut c))
                .is_some(),
            OverlayTrack::Graphic(t) => convert_all(elements, to_graphic)
                .map(|mut c| t.elements.append(&mut c))
                .is_some(),
            OverlayTrack::Effect(t) => convert_all(elements, to_effect)
                .map(|mut c| t.elements.append(&mut c))
                .is_some(),
        };
    }
    if let Some(track) = tracks.audio.iter_mut().find(|t| t.id == track_id) {
        return convert_all(elements, to_audio)
            .map(|mut c| track.elements.append(&mut c))
            .is_some();
    }
    false
}

pub fn overlay_id(track: &OverlayTrack) -> &str {
    match track {
        OverlayTrack::Video(t) => &t.id,
        OverlayTrack::Text(t) => &t.id,
        OverlayTrack::Graphic(t) => &t.id,
        OverlayTrack::Effect(t) => &t.id,
    }
}

/// Places `elements` per `placement_result`. `new_track_id` is only called
/// when a track is created. `Ok(None)` mirrors TS `null` (stale track index or
/// incompatible elements).
pub fn apply_placement(
    tracks: &SceneTracks,
    placement_result: &PlacementResult,
    elements: Vec<TimelineElement>,
    new_track_insert_index_override: Option<usize>,
    new_track_id: impl FnOnce() -> Result<String, TimelineError>,
) -> Result<Option<(SceneTracks, String)>, TimelineError> {
    match placement_result {
        PlacementResult::ExistingTrack { track_index, .. } => {
            let target_id = match ordered_tracks(tracks).get(*track_index) {
                Some(view) => view.id.to_string(),
                None => return Ok(None),
            };
            let mut updated = tracks.clone();
            if !append_elements(&mut updated, &target_id, elements) {
                return Ok(None);
            }
            Ok(Some((updated, target_id)))
        }
        PlacementResult::NewTrack {
            insert_index,
            track_type,
            ..
        } => {
            let id = new_track_id()?;
            let insert_index = new_track_insert_index_override.unwrap_or(*insert_index);
            let mut updated = tracks.clone();
            if *track_type == TrackType::Audio {
                let TimelineTrack::Audio(track) = build_empty_track(&id, TrackType::Audio, None)
                else {
                    unreachable!("audio track type builds an audio track")
                };
                let index = audio_insert_index(&updated, insert_index);
                updated.audio.insert(index, track);
            } else {
                let Some(track) = build_empty_overlay_track(&id, *track_type, None) else {
                    return Ok(None);
                };
                let index = insert_index.min(updated.overlay.len());
                updated.overlay.insert(index, track);
            }
            if !append_elements(&mut updated, &id, elements) {
                return Ok(None);
            }
            Ok(Some((updated, id)))
        }
    }
}

/// `max(0, min(insert_index - overlay.len - 1, audio.len))`.
pub fn audio_insert_index(tracks: &SceneTracks, insert_index: usize) -> usize {
    insert_index
        .saturating_sub(tracks.overlay.len() + 1)
        .min(tracks.audio.len())
}
