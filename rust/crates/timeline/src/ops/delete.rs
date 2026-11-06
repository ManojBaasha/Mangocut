//! `DeleteElements`. Mirrors `DeleteElementsCommand`: removes every element
//! matching a (track, element) pair; unknown pairs are ignored.

use super::Applied;
use super::elements::{element_id, ordered_track_ids, set_track_elements, track_elements};
use crate::error::TimelineError;
use crate::model::{ElementRef, SceneTracks};

pub(super) fn delete(
    tracks: &mut SceneTracks,
    targets: &[ElementRef],
) -> Result<Applied, TimelineError> {
    let mut removed = 0;
    for track_id in ordered_track_ids(tracks) {
        let Some(elements) = track_elements(tracks, &track_id) else {
            continue;
        };
        let before = elements.len();
        let kept: Vec<_> = elements
            .into_iter()
            .filter(|element| {
                !targets.iter().any(|target| {
                    target.track_id == track_id
                        && Some(target.element_id.as_str()) == element_id(element)
                })
            })
            .collect();
        if kept.len() != before {
            removed += before - kept.len();
            set_track_elements(tracks, &track_id, kept)?;
        }
    }
    Ok(Applied::summary(format!("deleted {removed} element(s)")))
}
