//! `SplitElements`. Mirrors `SplitElementsCommand`
//! (`apps/web/src/lib/commands/timeline/element/split-elements.ts`).

use serde_json::Value;

use super::{Applied, IdSource, RetainSide};
use crate::animation_split::split_animations_at_time;
use crate::error::TimelineError;
use crate::model::{
    AudioElement, EffectElement, ElementRef, GraphicElement, GraphicTrackElement, ImageElement,
    OverlayTrack, RetimeConfig, SceneTracks, StickerElement, TextElement, Ticks, VideoElement,
    VideoTrackElement,
};
use crate::retime::source_span_at_clip_time;

/// The fields a split reads and writes, shared by every element type.
struct SplitFields<'a> {
    id: &'a mut String,
    name: &'a mut String,
    start_time: &'a mut Ticks,
    duration: &'a mut Ticks,
    trim_start: &'a mut Ticks,
    trim_end: &'a mut Ticks,
    animations: &'a mut Option<Value>,
}

trait Splittable: Clone {
    fn fields(&mut self) -> SplitFields<'_>;
    /// `isRetimableElement(element) ? element.retime : undefined`.
    fn retime(&self) -> Option<&RetimeConfig>;
}

macro_rules! splittable {
    ($ty:ty, $self:ident => $retime:expr) => {
        impl Splittable for $ty {
            fn fields(&mut self) -> SplitFields<'_> {
                SplitFields {
                    id: &mut self.id,
                    name: &mut self.name,
                    start_time: &mut self.start_time,
                    duration: &mut self.duration,
                    trim_start: &mut self.trim_start,
                    trim_end: &mut self.trim_end,
                    animations: &mut self.animations,
                }
            }

            fn retime(&$self) -> Option<&RetimeConfig> {
                $retime
            }
        }
    };
}

splittable!(VideoElement, self => self.retime.as_ref());
splittable!(AudioElement, self => self.retime.as_ref());
splittable!(ImageElement, self => None);
splittable!(TextElement, self => None);
splittable!(StickerElement, self => None);
splittable!(GraphicElement, self => None);
splittable!(EffectElement, self => None);

impl Splittable for VideoTrackElement {
    fn fields(&mut self) -> SplitFields<'_> {
        match self {
            Self::Video(element) => element.fields(),
            Self::Image(element) => element.fields(),
        }
    }

    fn retime(&self) -> Option<&RetimeConfig> {
        match self {
            Self::Video(element) => element.retime(),
            Self::Image(element) => element.retime(),
        }
    }
}

impl Splittable for GraphicTrackElement {
    fn fields(&mut self) -> SplitFields<'_> {
        match self {
            Self::Sticker(element) => element.fields(),
            Self::Graphic(element) => element.fields(),
        }
    }

    fn retime(&self) -> Option<&RetimeConfig> {
        match self {
            Self::Sticker(element) => element.retime(),
            Self::Graphic(element) => element.retime(),
        }
    }
}

struct SplitRequest<'a> {
    targets: &'a [ElementRef],
    split_time: Ticks,
    retain_side: RetainSide,
}

fn reference(track_id: &str, element_id: String) -> ElementRef {
    ElementRef {
        track_id: track_id.to_string(),
        element_id,
        extra: Default::default(),
    }
}

/// `splitTrack`: splits the targeted elements of one track in place, in
/// element order, and returns the right-side refs it created.
fn split_track<E: Splittable>(
    track_id: &str,
    elements: &mut Vec<E>,
    request: &SplitRequest,
    ids: &mut IdSource,
    split_count: &mut usize,
) -> Result<Vec<ElementRef>, TimelineError> {
    let targets: Vec<&ElementRef> = request
        .targets
        .iter()
        .filter(|target| target.track_id == track_id)
        .collect();
    let mut right_side = Vec::new();
    if targets.is_empty() {
        return Ok(right_side);
    }

    let split_time = request.split_time.0;
    let mut next = Vec::with_capacity(elements.len());
    for mut element in std::mem::take(elements) {
        let retime = element.retime().cloned();
        let fields = element.fields();
        let should_split = targets.iter().any(|target| target.element_id == *fields.id);
        let effective_start = fields.start_time.0;
        let effective_end = fields.start_time.0 + fields.duration.0;
        if !should_split || split_time <= effective_start || split_time >= effective_end {
            next.push(element);
            continue;
        }

        let relative_time = split_time - fields.start_time.0;
        let left_visible_duration = relative_time;
        let right_visible_duration = fields.duration.0 - relative_time;
        let left_source_span =
            source_span_at_clip_time(Ticks(left_visible_duration), retime.as_ref()).0;
        let total_source_span = source_span_at_clip_time(*fields.duration, retime.as_ref()).0;
        let right_source_span = total_source_span - left_source_span;
        let (left_animations, right_animations) =
            split_animations_at_time(fields.animations.as_ref(), relative_time, true, ids)?;
        *split_count += 1;

        // Retime is carried over unchanged on both halves by the clone.
        let make_left = |mut left: E| {
            let fields = left.fields();
            *fields.duration = Ticks(left_visible_duration);
            *fields.trim_end = Ticks(fields.trim_end.0 + right_source_span);
            fields.name.push_str(" (left)");
            *fields.animations = left_animations.clone();
            left
        };
        let make_right = |mut right: E, id: String| {
            let fields = right.fields();
            *fields.id = id;
            *fields.start_time = Ticks(split_time);
            *fields.duration = Ticks(right_visible_duration);
            *fields.trim_start = Ticks(fields.trim_start.0 + left_source_span);
            fields.name.push_str(" (right)");
            *fields.animations = right_animations.clone();
            right
        };

        match request.retain_side {
            RetainSide::Left => next.push(make_left(element)),
            RetainSide::Right => {
                let id = ids.next()?;
                right_side.push(reference(track_id, id.clone()));
                next.push(make_right(element, id));
            }
            RetainSide::Both => {
                let id = ids.next()?;
                right_side.push(reference(track_id, id.clone()));
                next.push(make_left(element.clone()));
                next.push(make_right(element, id));
            }
        }
    }
    *elements = next;
    Ok(right_side)
}

pub(super) fn split(
    tracks: &mut SceneTracks,
    targets: &[ElementRef],
    split_time: Ticks,
    retain_side: RetainSide,
    ids: &mut IdSource,
) -> Result<Applied, TimelineError> {
    for target in targets {
        super::lookup::require_element(tracks, &target.track_id, &target.element_id)?;
    }
    let request = SplitRequest {
        targets,
        split_time,
        retain_side,
    };
    let mut right_side = Vec::new();
    let mut split_count = 0;

    for track in &mut tracks.overlay {
        right_side.extend(match track {
            OverlayTrack::Video(t) => {
                split_track(&t.id, &mut t.elements, &request, ids, &mut split_count)
            }
            OverlayTrack::Text(t) => {
                split_track(&t.id, &mut t.elements, &request, ids, &mut split_count)
            }
            OverlayTrack::Graphic(t) => {
                split_track(&t.id, &mut t.elements, &request, ids, &mut split_count)
            }
            OverlayTrack::Effect(t) => {
                split_track(&t.id, &mut t.elements, &request, ids, &mut split_count)
            }
        }?);
    }
    let main = &mut tracks.main;
    right_side.extend(split_track(
        &main.id,
        &mut main.elements,
        &request,
        ids,
        &mut split_count,
    )?);
    for track in &mut tracks.audio {
        right_side.extend(split_track(
            &track.id,
            &mut track.elements,
            &request,
            ids,
            &mut split_count,
        )?);
    }

    // `select` is `getRightSideElements()`; a "left" split creates nothing.
    // The right halves are new elements for "both" and "right" alike.
    let summary = if split_count == 0 {
        "no elements split".to_string()
    } else {
        format!("split {split_count} element(s) at {}", split_time.0)
    };
    Ok(Applied {
        select: right_side.clone(),
        created: right_side,
        summary,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ops::{ApplyOpOptions, TimelineOp, apply_op};
    use serde_json::json;

    fn scene() -> SceneTracks {
        serde_json::from_value(json!({
            "overlay": [],
            "main": {"id": "main", "name": "Main", "type": "video", "muted": false, "hidden": false,
                "elements": [{
                    "type": "video", "id": "el-1", "mediaId": "m", "name": "clip",
                    "duration": 100, "startTime": 0, "trimStart": 0, "trimEnd": 0,
                    "transform": {"scaleX": 1, "scaleY": 1, "position": {"x": 0, "y": 0}, "rotate": 0},
                    "opacity": 1
                }]},
            "audio": []
        }))
        .unwrap()
    }

    fn run(side: RetainSide, split_time: f64, new_ids: &[&str]) -> crate::ops::OpOutput {
        apply_op(ApplyOpOptions {
            tracks: scene(),
            op: TimelineOp::SplitElements {
                elements: vec![reference("main", "el-1".into())],
                split_time: Ticks(split_time),
                retain_side: side,
            },
            new_ids: new_ids.iter().map(|id| id.to_string()).collect(),
            ripple: false,
            validate: true,
        })
        .unwrap()
    }

    #[test]
    fn both_selects_and_creates_right_half() {
        let output = run(RetainSide::Both, 40.0, &["r"]);
        assert!(output.changed);
        assert_eq!(output.select, vec![reference("main", "r".into())]);
        assert_eq!(output.created, output.select);
        assert_eq!(output.tracks.main.elements.len(), 2);
    }

    #[test]
    fn left_creates_nothing() {
        let output = run(RetainSide::Left, 40.0, &[]);
        assert!(output.changed);
        assert!(output.select.is_empty());
        assert!(output.created.is_empty());
    }

    #[test]
    fn split_at_bounds_is_unchanged() {
        assert!(!run(RetainSide::Both, 0.0, &["r"]).changed);
        assert!(!run(RetainSide::Both, 100.0, &["r"]).changed);
    }

    #[test]
    fn missing_ids_error() {
        let error = apply_op(ApplyOpOptions {
            tracks: scene(),
            op: TimelineOp::SplitElements {
                elements: vec![reference("main", "el-1".into())],
                split_time: Ticks(40.0),
                retain_side: RetainSide::Right,
            },
            new_ids: vec![],
            ripple: false,
            validate: true,
        })
        .unwrap_err();
        assert_eq!(error, TimelineError::missing_ids());
    }
}
