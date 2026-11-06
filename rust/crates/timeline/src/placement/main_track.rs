use crate::model::{SceneTracks, Ticks, VideoTrack, VideoTrackElement};

#[allow(dead_code)]
pub const MAIN_TRACK_NAME: &str = "Main Track";

fn start_time(element: &VideoTrackElement) -> Ticks {
    match element {
        VideoTrackElement::Video(e) => e.start_time,
        VideoTrackElement::Image(e) => e.start_time,
    }
}

fn id(element: &VideoTrackElement) -> &str {
    match element {
        VideoTrackElement::Video(e) => &e.id,
        VideoTrackElement::Image(e) => &e.id,
    }
}

pub fn earliest_main_track_element<'a>(
    main_track: &'a VideoTrack,
    exclude_element_id: Option<&str>,
) -> Option<&'a VideoTrackElement> {
    main_track
        .elements
        .iter()
        .filter(|element| exclude_element_id.is_none_or(|exclude| id(element) != exclude))
        .reduce(|earliest, element| {
            if start_time(element).0 < start_time(earliest).0 {
                element
            } else {
                earliest
            }
        })
}

pub fn enforce_main_track_start(
    tracks: &SceneTracks,
    target_track_id: &str,
    requested_start_time: Ticks,
    exclude_element_id: Option<&str>,
) -> Ticks {
    if tracks.main.id != target_track_id {
        return requested_start_time;
    }
    let Some(earliest) = earliest_main_track_element(&tracks.main, exclude_element_id) else {
        return Ticks(0.0);
    };
    if requested_start_time.0 <= start_time(earliest).0 {
        return Ticks(0.0);
    }
    requested_start_time
}
