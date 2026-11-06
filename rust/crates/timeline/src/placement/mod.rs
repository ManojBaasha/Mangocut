//! Track placement. One-to-one port of `apps/web/src/lib/timeline/placement`.

mod apply;
mod compatibility;
mod insert_index;
mod main_track;
mod overlap;
mod resolve;
mod track_factory;

use serde::{Deserialize, Serialize};

use crate::model::{
    AudioTrack, OverlayTrack, SceneTracks, Ticks, TimelineElement, VideoTrack, VideoTrackElement,
};

pub use apply::{apply_placement, audio_insert_index, overlay_id};
pub use compatibility::{
    can_element_go_on_track, track_type_for_element_type, validate_element_track_compatibility,
};
pub use insert_index::default_insert_index_for_track;
pub use main_track::{earliest_main_track_element, enforce_main_track_start};
pub use overlap::can_place_time_spans_on_track;
pub use resolve::resolve_track_placement;
pub use track_factory::{build_empty_overlay_track, build_empty_track};

#[cfg_attr(feature = "wasm", derive(tsify_next::Tsify))]
#[cfg_attr(feature = "wasm", tsify(into_wasm_abi, from_wasm_abi, hashmap_as_object))]
#[derive(Serialize, Deserialize, Clone, Copy, Debug, Eq, PartialEq)]
#[serde(rename_all = "camelCase")]
pub enum TrackType {
    Video,
    Text,
    Audio,
    Graphic,
    Effect,
}

#[cfg_attr(feature = "wasm", derive(tsify_next::Tsify))]
#[cfg_attr(feature = "wasm", tsify(into_wasm_abi, from_wasm_abi, hashmap_as_object))]
#[derive(Serialize, Deserialize, Clone, Copy, Debug, Eq, PartialEq)]
#[serde(rename_all = "camelCase")]
pub enum ElementType {
    Audio,
    Text,
    Sticker,
    Graphic,
    Effect,
    Video,
    Image,
}

impl ElementType {
    pub fn of(element: &TimelineElement) -> Self {
        match element {
            TimelineElement::Audio(_) => Self::Audio,
            TimelineElement::Video(_) => Self::Video,
            TimelineElement::Image(_) => Self::Image,
            TimelineElement::Text(_) => Self::Text,
            TimelineElement::Sticker(_) => Self::Sticker,
            TimelineElement::Graphic(_) => Self::Graphic,
            TimelineElement::Effect(_) => Self::Effect,
        }
    }
}

#[derive(Clone, Debug, PartialEq)]
pub struct PlacementTimeSpan {
    pub start_time: Ticks,
    pub duration: Ticks,
    pub exclude_element_id: Option<String>,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub enum PlacementSubject {
    ElementType(ElementType),
    TrackType(TrackType),
}

#[cfg_attr(feature = "wasm", derive(tsify_next::Tsify))]
#[cfg_attr(feature = "wasm", tsify(into_wasm_abi, from_wasm_abi, hashmap_as_object))]
#[derive(Serialize, Deserialize, Clone, Copy, Debug, Eq, PartialEq)]
#[serde(rename_all = "camelCase")]
pub enum Direction {
    Above,
    Below,
}

#[derive(Serialize, Deserialize, Clone, Copy, Debug, Eq, PartialEq)]
#[serde(rename_all = "camelCase")]
pub enum VerticalDragDirection {
    Up,
    Down,
}

// Ported with the TS placement model; later phases construct every variant.
#[allow(dead_code)]
#[derive(Clone, Debug, PartialEq)]
pub enum PlacementStrategy {
    Explicit {
        track_id: String,
    },
    FirstAvailable,
    PreferIndex {
        track_index: usize,
        hover_direction: Direction,
        vertical_drag_direction: Option<VerticalDragDirection>,
        create_new_track_only: bool,
    },
    AboveSource {
        source_track_index: usize,
    },
    AlwaysNew {
        position: NewTrackPosition,
    },
}

#[allow(dead_code)]
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum NewTrackPosition {
    Highest,
    Default,
}

#[derive(Clone, Debug, PartialEq)]
pub enum PlacementResult {
    ExistingTrack {
        track_id: String,
        track_index: usize,
        track_type: TrackType,
        adjusted_start_time: Option<Ticks>,
    },
    NewTrack {
        insert_index: usize,
        insert_position: Option<Direction>,
        track_type: TrackType,
    },
}

/// Borrowed view of one track: what placement needs (id, type, element spans).
#[derive(Clone, Debug, PartialEq)]
pub struct TrackView<'a> {
    pub id: &'a str,
    pub track_type: TrackType,
    pub elements: Vec<ElementSpan<'a>>,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct ElementSpan<'a> {
    pub id: &'a str,
    pub start_time: Ticks,
    pub duration: Ticks,
}

fn video_spans(track: &VideoTrack) -> Vec<ElementSpan<'_>> {
    track
        .elements
        .iter()
        .map(|element| match element {
            VideoTrackElement::Video(e) => span(&e.id, e.start_time, e.duration),
            VideoTrackElement::Image(e) => span(&e.id, e.start_time, e.duration),
        })
        .collect()
}

fn span(id: &str, start_time: Ticks, duration: Ticks) -> ElementSpan<'_> {
    ElementSpan {
        id,
        start_time,
        duration,
    }
}

pub fn video_track_view(track: &VideoTrack) -> TrackView<'_> {
    TrackView {
        id: &track.id,
        track_type: TrackType::Video,
        elements: video_spans(track),
    }
}

fn audio_track_view(track: &AudioTrack) -> TrackView<'_> {
    TrackView {
        id: &track.id,
        track_type: TrackType::Audio,
        elements: track
            .elements
            .iter()
            .map(|e| span(&e.id, e.start_time, e.duration))
            .collect(),
    }
}

fn overlay_track_view(track: &OverlayTrack) -> TrackView<'_> {
    use crate::model::GraphicTrackElement;
    match track {
        OverlayTrack::Video(track) => video_track_view(track),
        OverlayTrack::Text(track) => TrackView {
            id: &track.id,
            track_type: TrackType::Text,
            elements: track
                .elements
                .iter()
                .map(|e| span(&e.id, e.start_time, e.duration))
                .collect(),
        },
        OverlayTrack::Graphic(track) => TrackView {
            id: &track.id,
            track_type: TrackType::Graphic,
            elements: track
                .elements
                .iter()
                .map(|element| match element {
                    GraphicTrackElement::Sticker(e) => span(&e.id, e.start_time, e.duration),
                    GraphicTrackElement::Graphic(e) => span(&e.id, e.start_time, e.duration),
                })
                .collect(),
        },
        OverlayTrack::Effect(track) => TrackView {
            id: &track.id,
            track_type: TrackType::Effect,
            elements: track
                .elements
                .iter()
                .map(|e| span(&e.id, e.start_time, e.duration))
                .collect(),
        },
    }
}

/// `[...overlay, main, ...audio]`, the order TS indexes tracks by.
pub fn ordered_tracks(tracks: &SceneTracks) -> Vec<TrackView<'_>> {
    let mut views: Vec<TrackView<'_>> = tracks.overlay.iter().map(overlay_track_view).collect();
    views.push(video_track_view(&tracks.main));
    views.extend(tracks.audio.iter().map(audio_track_view));
    views
}
