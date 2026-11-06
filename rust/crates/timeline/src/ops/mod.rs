//! The single entry point for timeline edits.

mod insert;
mod split;

use bridge::export;
use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::error::TimelineError;
use crate::model::{ElementRef, OverlayTrack, RetimeConfig, SceneTracks, Ticks};
use crate::placement::{
    TrackType, audio_insert_index, build_empty_overlay_track, build_empty_track,
    default_insert_index_for_track,
};

#[cfg_attr(feature = "wasm", derive(tsify_next::Tsify))]
#[cfg_attr(feature = "wasm", tsify(into_wasm_abi, from_wasm_abi))]
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(
    tag = "type",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum TimelineOp {
    InsertElement {
        /// `CreateTimelineElement`.
        element: Value,
        placement: InsertPlacement,
    },
    SplitElements {
        elements: Vec<ElementRef>,
        split_time: Ticks,
        #[serde(default)]
        retain_side: RetainSide,
    },
    TrimElement {
        element_id: String,
        trim_start: Ticks,
        trim_end: Ticks,
        #[serde(default)]
        start_time: Option<Ticks>,
        #[serde(default)]
        duration: Option<Ticks>,
    },
    RetimeElement {
        track_id: String,
        element_id: String,
        #[serde(default)]
        retime: Option<RetimeConfig>,
    },
    MoveElement {
        source_track_id: String,
        target_track_id: String,
        element_id: String,
        new_start_time: Ticks,
        #[serde(default)]
        create_track: Option<CreateTrack>,
    },
    DeleteElements {
        elements: Vec<ElementRef>,
    },
    DuplicateElements {
        elements: Vec<ElementRef>,
    },
    UpdateElements {
        updates: Vec<ElementUpdate>,
    },
    AddTrack {
        track_type: TrackType,
        #[serde(default)]
        index: Option<usize>,
    },
    RemoveTrack {
        track_id: String,
    },
    ToggleTrackMute {
        track_id: String,
    },
    ToggleTrackVisibility {
        track_id: String,
    },
    Batch {
        ops: Vec<TimelineOp>,
    },
}

#[cfg_attr(feature = "wasm", derive(tsify_next::Tsify))]
#[cfg_attr(feature = "wasm", tsify(into_wasm_abi, from_wasm_abi))]
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(
    tag = "mode",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum InsertPlacement {
    Explicit {
        track_id: String,
    },
    Auto {
        #[serde(default)]
        track_type: Option<TrackType>,
        #[serde(default)]
        insert_index: Option<usize>,
    },
}

#[cfg_attr(feature = "wasm", derive(tsify_next::Tsify))]
#[cfg_attr(feature = "wasm", tsify(into_wasm_abi, from_wasm_abi))]
#[derive(Serialize, Deserialize, Clone, Copy, Debug, Default, Eq, PartialEq)]
#[serde(rename_all = "camelCase")]
pub enum RetainSide {
    #[default]
    Both,
    Left,
    Right,
}

#[cfg_attr(feature = "wasm", derive(tsify_next::Tsify))]
#[cfg_attr(feature = "wasm", tsify(into_wasm_abi, from_wasm_abi))]
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CreateTrack {
    #[serde(rename = "type")]
    pub track_type: TrackType,
    pub index: usize,
}

#[cfg_attr(feature = "wasm", derive(tsify_next::Tsify))]
#[cfg_attr(feature = "wasm", tsify(into_wasm_abi, from_wasm_abi))]
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ElementUpdate {
    pub track_id: String,
    pub element_id: String,
    pub patch: Value,
}

#[cfg_attr(feature = "wasm", derive(tsify_next::Tsify))]
#[cfg_attr(feature = "wasm", tsify(into_wasm_abi, from_wasm_abi))]
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ApplyOpOptions {
    pub tracks: SceneTracks,
    pub op: TimelineOp,
    /// Ids for anything the op creates, consumed in order.
    #[serde(default)]
    pub new_ids: Vec<String>,
    #[serde(default)]
    pub ripple: bool,
}

#[cfg_attr(feature = "wasm", derive(tsify_next::Tsify))]
#[cfg_attr(feature = "wasm", tsify(into_wasm_abi, from_wasm_abi))]
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct OpOutput {
    pub tracks: SceneTracks,
    pub changed: bool,
    pub select: Vec<ElementRef>,
    pub created: Vec<ElementRef>,
    pub summary: String,
}

/// Hands out `new_ids` in order.
pub(crate) struct IdSource {
    ids: std::vec::IntoIter<String>,
}

impl IdSource {
    pub(crate) fn new(ids: Vec<String>) -> Self {
        Self {
            ids: ids.into_iter(),
        }
    }

    pub(crate) fn next(&mut self) -> Result<String, TimelineError> {
        self.ids.next().ok_or_else(TimelineError::missing_ids)
    }
}

struct Applied {
    select: Vec<ElementRef>,
    created: Vec<ElementRef>,
    summary: String,
}

impl Applied {
    fn summary(summary: impl Into<String>) -> Self {
        Self {
            select: Vec::new(),
            created: Vec::new(),
            summary: summary.into(),
        }
    }
}

#[export]
pub fn apply_op(options: ApplyOpOptions) -> Result<OpOutput, TimelineError> {
    let ApplyOpOptions {
        tracks,
        op,
        new_ids,
        // Ripple is applied by the element ops (Task 5+); track ops never ripple.
        ripple: _,
    } = options;
    let mut ids = IdSource::new(new_ids);
    let mut next = tracks.clone();
    let applied = apply(&mut next, &op, &mut ids)?;
    let changed = next != tracks;
    Ok(OpOutput {
        tracks: next,
        changed,
        select: applied.select,
        created: applied.created,
        summary: applied.summary,
    })
}

fn apply(
    tracks: &mut SceneTracks,
    op: &TimelineOp,
    ids: &mut IdSource,
) -> Result<Applied, TimelineError> {
    match op {
        TimelineOp::Batch { ops } => {
            let mut select = Vec::new();
            let mut created = Vec::new();
            let mut summaries = Vec::new();
            for (index, op) in ops.iter().enumerate() {
                let applied = apply(tracks, op, ids)
                    .map_err(|error| error.prefixed(&format!("op {index}: ")))?;
                select = applied.select;
                created.extend(applied.created);
                summaries.push(applied.summary);
            }
            Ok(Applied {
                select,
                created,
                summary: summaries.join("; "),
            })
        }
        TimelineOp::AddTrack { track_type, index } => {
            let id = ids.next()?;
            add_track(tracks, *track_type, *index, &id);
            Ok(Applied::summary(format!(
                "added {} track",
                track_type_name(*track_type)
            )))
        }
        TimelineOp::RemoveTrack { track_id } => remove_track(tracks, track_id),
        TimelineOp::ToggleTrackMute { track_id } => toggle_track_mute(tracks, track_id),
        TimelineOp::ToggleTrackVisibility { track_id } => toggle_track_visibility(tracks, track_id),
        TimelineOp::InsertElement { element, placement } => {
            insert::insert(tracks, element, placement, ids)
        }
        TimelineOp::SplitElements {
            elements,
            split_time,
            retain_side,
        } => split::split(tracks, elements, *split_time, *retain_side, ids),
        TimelineOp::TrimElement { .. } => Err(TimelineError::unsupported_op("trimElement")),
        TimelineOp::RetimeElement { .. } => Err(TimelineError::unsupported_op("retimeElement")),
        TimelineOp::MoveElement { .. } => Err(TimelineError::unsupported_op("moveElement")),
        TimelineOp::DeleteElements { .. } => Err(TimelineError::unsupported_op("deleteElements")),
        TimelineOp::DuplicateElements { .. } => {
            Err(TimelineError::unsupported_op("duplicateElements"))
        }
        TimelineOp::UpdateElements { .. } => Err(TimelineError::unsupported_op("updateElements")),
    }
}

fn track_type_name(track_type: TrackType) -> &'static str {
    match track_type {
        TrackType::Video => "video",
        TrackType::Text => "text",
        TrackType::Audio => "audio",
        TrackType::Graphic => "graphic",
        TrackType::Effect => "effect",
    }
}

/// Mirrors `AddTrackCommand`.
fn add_track(tracks: &mut SceneTracks, track_type: TrackType, index: Option<usize>, id: &str) {
    let insert_index = index.unwrap_or_else(|| default_insert_index_for_track(tracks, track_type));
    if track_type == TrackType::Audio {
        if let crate::model::TimelineTrack::Audio(track) =
            build_empty_track(id, TrackType::Audio, None)
        {
            let at = audio_insert_index(tracks, insert_index);
            tracks.audio.insert(at, track);
        }
    } else if let Some(track) = build_empty_overlay_track(id, track_type, None) {
        let at = insert_index.min(tracks.overlay.len());
        tracks.overlay.insert(at, track);
    }
}

/// Mirrors `RemoveTrackCommand`: the main track is never removed (matching
/// ids are filtered from overlay/audio only), so removing it changes nothing.
fn remove_track(tracks: &mut SceneTracks, track_id: &str) -> Result<Applied, TimelineError> {
    if tracks.main.id == track_id {
        return Ok(Applied::summary("main track cannot be removed"));
    }
    let overlay_before = tracks.overlay.len();
    let audio_before = tracks.audio.len();
    tracks
        .overlay
        .retain(|track| crate::placement::overlay_id(track) != track_id);
    tracks.audio.retain(|track| track.id != track_id);
    if tracks.overlay.len() == overlay_before && tracks.audio.len() == audio_before {
        return Err(TimelineError::track_not_found(track_id));
    }
    Ok(Applied::summary(format!("removed track {track_id}")))
}

fn toggle_track_mute(tracks: &mut SceneTracks, track_id: &str) -> Result<Applied, TimelineError> {
    if tracks.main.id == track_id {
        tracks.main.muted = !tracks.main.muted;
    } else if let Some(OverlayTrack::Video(track)) = tracks
        .overlay
        .iter_mut()
        .find(|track| crate::placement::overlay_id(track) == track_id)
    {
        track.muted = !track.muted;
    } else if let Some(track) = tracks.audio.iter_mut().find(|track| track.id == track_id) {
        track.muted = !track.muted;
    } else if !has_track(tracks, track_id) {
        return Err(TimelineError::track_not_found(track_id));
    }
    Ok(Applied::summary(format!(
        "toggled mute on track {track_id}"
    )))
}

fn toggle_track_visibility(
    tracks: &mut SceneTracks,
    track_id: &str,
) -> Result<Applied, TimelineError> {
    if tracks.main.id == track_id {
        tracks.main.hidden = !tracks.main.hidden;
    } else if let Some(track) = tracks
        .overlay
        .iter_mut()
        .find(|track| crate::placement::overlay_id(track) == track_id)
    {
        match track {
            OverlayTrack::Video(t) => t.hidden = !t.hidden,
            OverlayTrack::Text(t) => t.hidden = !t.hidden,
            OverlayTrack::Graphic(t) => t.hidden = !t.hidden,
            OverlayTrack::Effect(t) => t.hidden = !t.hidden,
        }
    } else if !has_track(tracks, track_id) {
        return Err(TimelineError::track_not_found(track_id));
    }
    Ok(Applied::summary(format!(
        "toggled visibility on track {track_id}"
    )))
}

fn has_track(tracks: &SceneTracks, track_id: &str) -> bool {
    tracks.main.id == track_id
        || tracks
            .overlay
            .iter()
            .any(|track| crate::placement::overlay_id(track) == track_id)
        || tracks.audio.iter().any(|track| track.id == track_id)
}
