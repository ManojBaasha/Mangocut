//! Track invariants. `apply_op` checks its output against these and blames
//! only violations the input did not already have.
//!
//! Invariants: an element's type is allowed on its track; elements on one
//! track do not overlap (touching is fine); `duration > 0`; `trimStart` and
//! `trimEnd` are `>= 0`; `trimStart + trimEnd < sourceDuration` when the
//! source duration is known. Numbers are compared exactly as stored (no
//! rounding), and a NaN or infinite value always violates.

// `!(x > 0.0)` is deliberate: it also rejects NaN.
#![allow(clippy::neg_cmp_op_on_partial_ord)]

use bridge::export;
use serde::{Deserialize, Serialize};

use crate::error::TimelineError;
use crate::model::{
    AudioElement, EffectElement, GraphicElement, GraphicTrackElement, ImageElement, OverlayTrack,
    SceneTracks, StickerElement, TextElement, VideoElement, VideoTrackElement,
};
use crate::placement::{ElementType, TrackType, can_element_go_on_track};

#[cfg_attr(feature = "wasm", derive(tsify_next::Tsify))]
#[cfg_attr(feature = "wasm", tsify(into_wasm_abi, from_wasm_abi, hashmap_as_object))]
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ValidateOptions {
    pub tracks: SceneTracks,
}

/// One broken invariant. `key` identifies it independent of its numbers, so
/// a violation present both before and after an edit is the same violation.
#[derive(Clone, Debug)]
pub(crate) struct Violation {
    pub code: &'static str,
    pub track_id: String,
    pub element_id: String,
    pub other_id: Option<String>,
    pub message: String,
    pub hint: String,
}

type ViolationKey<'a> = (&'static str, &'a str, &'a str, Option<&'a str>);

impl Violation {
    pub(crate) fn key(&self) -> ViolationKey<'_> {
        (
            self.code,
            &self.track_id,
            &self.element_id,
            self.other_id.as_deref(),
        )
    }

    pub(crate) fn into_error(self) -> TimelineError {
        TimelineError::new(self.code, self.message).with_hint(self.hint)
    }
}

struct Facts {
    id: String,
    kind: ElementType,
    start: f64,
    duration: f64,
    trim_start: f64,
    trim_end: f64,
    source_duration: Option<f64>,
}

macro_rules! facts_of {
    ($element:expr, $kind:expr) => {
        Facts {
            id: $element.id.clone(),
            kind: $kind,
            start: $element.start_time.0,
            duration: $element.duration.0,
            trim_start: $element.trim_start.0,
            trim_end: $element.trim_end.0,
            source_duration: $element.source_duration.map(|ticks| ticks.0),
        }
    };
}

fn audio(e: &AudioElement) -> Facts {
    facts_of!(e, ElementType::Audio)
}
fn video(e: &VideoElement) -> Facts {
    facts_of!(e, ElementType::Video)
}
fn image(e: &ImageElement) -> Facts {
    facts_of!(e, ElementType::Image)
}
fn text(e: &TextElement) -> Facts {
    facts_of!(e, ElementType::Text)
}
fn sticker(e: &StickerElement) -> Facts {
    facts_of!(e, ElementType::Sticker)
}
fn graphic(e: &GraphicElement) -> Facts {
    facts_of!(e, ElementType::Graphic)
}
fn effect(e: &EffectElement) -> Facts {
    facts_of!(e, ElementType::Effect)
}

fn video_facts(elements: &[VideoTrackElement]) -> Vec<Facts> {
    elements
        .iter()
        .map(|element| match element {
            VideoTrackElement::Video(e) => video(e),
            VideoTrackElement::Image(e) => image(e),
        })
        .collect()
}

fn graphic_facts(elements: &[GraphicTrackElement]) -> Vec<Facts> {
    elements
        .iter()
        .map(|element| match element {
            GraphicTrackElement::Sticker(e) => sticker(e),
            GraphicTrackElement::Graphic(e) => graphic(e),
        })
        .collect()
}

/// `(track id, track type, element facts)` in `[overlay, main, audio]` order.
fn collect(tracks: &SceneTracks) -> Vec<(&str, TrackType, Vec<Facts>)> {
    let mut all: Vec<(&str, TrackType, Vec<Facts>)> = Vec::new();
    for track in &tracks.overlay {
        all.push(match track {
            OverlayTrack::Video(t) => (&t.id, TrackType::Video, video_facts(&t.elements)),
            OverlayTrack::Text(t) => (
                &t.id,
                TrackType::Text,
                t.elements.iter().map(text).collect(),
            ),
            OverlayTrack::Graphic(t) => (&t.id, TrackType::Graphic, graphic_facts(&t.elements)),
            OverlayTrack::Effect(t) => (
                &t.id,
                TrackType::Effect,
                t.elements.iter().map(effect).collect(),
            ),
        });
    }
    all.push((
        &tracks.main.id,
        TrackType::Video,
        video_facts(&tracks.main.elements),
    ));
    for track in &tracks.audio {
        all.push((
            &track.id,
            TrackType::Audio,
            track.elements.iter().map(audio).collect(),
        ));
    }
    all
}

fn type_name(track_type: TrackType) -> &'static str {
    match track_type {
        TrackType::Video => "video",
        TrackType::Text => "text",
        TrackType::Audio => "audio",
        TrackType::Graphic => "graphic",
        TrackType::Effect => "effect",
    }
}

fn violation(
    code: &'static str,
    track_id: &str,
    element_id: &str,
    other_id: Option<&str>,
    message: String,
    hint: String,
) -> Violation {
    Violation {
        code,
        track_id: track_id.to_string(),
        element_id: element_id.to_string(),
        other_id: other_id.map(str::to_string),
        message,
        hint,
    }
}

fn check_element(track_id: &str, track_type: TrackType, e: &Facts, out: &mut Vec<Violation>) {
    if !can_element_go_on_track(e.kind, track_type) {
        out.push(violation(
            "incompatible_track",
            track_id,
            &e.id,
            None,
            format!(
                "element {} cannot be on {} track {track_id}",
                e.id,
                type_name(track_type)
            ),
            "move the element to a track of the matching type".to_string(),
        ));
    }
    if !e.start.is_finite() {
        out.push(violation(
            "invalid_start_time",
            track_id,
            &e.id,
            None,
            format!("element {} has a non-finite startTime ({})", e.id, e.start),
            "startTime must be a finite number of ticks".to_string(),
        ));
    }
    if !(e.duration > 0.0 && e.duration.is_finite()) {
        out.push(violation(
            "invalid_duration",
            track_id,
            &e.id,
            None,
            format!("element {} has duration {}", e.id, e.duration),
            "duration must be a finite number of ticks greater than 0".to_string(),
        ));
    }
    if !(e.trim_start >= 0.0
        && e.trim_end >= 0.0
        && e.trim_start.is_finite()
        && e.trim_end.is_finite())
    {
        out.push(violation(
            "invalid_trim",
            track_id,
            &e.id,
            None,
            format!(
                "element {} has trimStart {} and trimEnd {}",
                e.id, e.trim_start, e.trim_end
            ),
            "trimStart and trimEnd must be finite and at least 0".to_string(),
        ));
    } else if let Some(source) = e.source_duration
        && !(e.trim_start + e.trim_end < source)
    {
        out.push(violation(
            "invalid_trim",
            track_id,
            &e.id,
            None,
            format!(
                "element {} trims {} ticks of a {source} tick source",
                e.id,
                e.trim_start + e.trim_end
            ),
            format!("trimStart + trimEnd must stay below the source duration {source}"),
        ));
    }
}

fn collect_violations(tracks: &SceneTracks) -> Vec<Violation> {
    let mut out = Vec::new();
    for (track_id, track_type, elements) in collect(tracks) {
        for element in &elements {
            check_element(track_id, track_type, element, &mut out);
        }
        for (index, first) in elements.iter().enumerate() {
            for second in &elements[index + 1..] {
                let both_valid = first.duration > 0.0 && second.duration > 0.0;
                if both_valid
                    && first.start < second.start + second.duration
                    && first.start + first.duration > second.start
                {
                    out.push(violation(
                        "overlap",
                        track_id,
                        &first.id,
                        Some(&second.id),
                        format!(
                            "elements {} and {} overlap on track {track_id}",
                            first.id, second.id
                        ),
                        format!(
                            "elements on one track may only touch; move one to another {} track or shift its startTime",
                            type_name(track_type)
                        ),
                    ));
                }
            }
        }
    }
    out
}

/// The first violation in `after` that `before` did not already have.
pub(crate) fn first_new_violation(before: &SceneTracks, after: &SceneTracks) -> Option<Violation> {
    let existing = collect_violations(before);
    collect_violations(after)
        .into_iter()
        .find(|violation| !existing.iter().any(|old| old.key() == violation.key()))
}

/// Every broken invariant in `tracks`, empty when the timeline is valid.
#[export]
pub fn validate_tracks(options: ValidateOptions) -> Vec<TimelineError> {
    collect_violations(&options.tracks)
        .into_iter()
        .map(Violation::into_error)
        .collect()
}
