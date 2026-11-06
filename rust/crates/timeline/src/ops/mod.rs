//! The single entry point for timeline edits.

mod delete;
mod duplicate;
pub(crate) mod elements;
mod insert;
mod lookup;
mod move_element;
mod retime;
mod split;
mod trim;
mod update;
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
#[cfg_attr(feature = "wasm", tsify(into_wasm_abi, from_wasm_abi, hashmap_as_object))]
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
        track_id: String,
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
#[cfg_attr(feature = "wasm", tsify(into_wasm_abi, from_wasm_abi, hashmap_as_object))]
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
#[cfg_attr(feature = "wasm", tsify(into_wasm_abi, from_wasm_abi, hashmap_as_object))]
#[derive(Serialize, Deserialize, Clone, Copy, Debug, Default, Eq, PartialEq)]
#[serde(rename_all = "camelCase")]
pub enum RetainSide {
    #[default]
    Both,
    Left,
    Right,
}

#[cfg_attr(feature = "wasm", derive(tsify_next::Tsify))]
#[cfg_attr(feature = "wasm", tsify(into_wasm_abi, from_wasm_abi, hashmap_as_object))]
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CreateTrack {
    #[serde(rename = "type")]
    pub track_type: TrackType,
    pub index: usize,
}

#[cfg_attr(feature = "wasm", derive(tsify_next::Tsify))]
#[cfg_attr(feature = "wasm", tsify(into_wasm_abi, from_wasm_abi, hashmap_as_object))]
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ElementUpdate {
    pub track_id: String,
    pub element_id: String,
    pub patch: Value,
}

#[cfg_attr(feature = "wasm", derive(tsify_next::Tsify))]
#[cfg_attr(feature = "wasm", tsify(into_wasm_abi, from_wasm_abi, hashmap_as_object))]
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
    /// Reject edits that leave a new invariant violation (overlap, invalid
    /// trim/duration...) with `invalid_result`. Defaults to true (agents);
    /// the editor UI passes false to keep its pre-port permissiveness. Errors
    /// raised by the ops themselves (unknown ids, immutable fields, ids)
    /// still apply.
    #[serde(default = "default_true")]
    #[cfg_attr(feature = "wasm", tsify(optional))]
    pub validate: bool,
}

fn default_true() -> bool {
    true
}

#[cfg_attr(feature = "wasm", derive(tsify_next::Tsify))]
#[cfg_attr(feature = "wasm", tsify(into_wasm_abi, from_wasm_abi, hashmap_as_object))]
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
        ripple,
        validate,
    } = options;
    check_new_ids(&tracks, &new_ids)?;
    let mut ids = IdSource::new(new_ids);
    let mut next = tracks.clone();
    let applied = apply(&mut next, &op, &mut ids)?;
    // Like `CommandManager.execute`: ripple runs once, after the whole op.
    if ripple {
        let adjustments = crate::ripple::compute(&tracks, &next);
        next = crate::ripple::apply(&next, &adjustments)?;
    }
    let changed = next != tracks;
    // Blame only violations the input did not already have.
    if validate
        && changed
        && let Some(violation) = crate::validate::first_new_violation(&tracks, &next) {
        let error = violation.into_error();
        return Err(TimelineError::invalid_result(
            format!(
                "the edit would leave the timeline invalid: {}",
                error.message
            ),
            error.hint.unwrap_or_default(),
        ));
    }
    Ok(OpOutput {
        tracks: next,
        changed,
        select: applied.select,
        created: applied.created,
        summary: applied.summary,
    })
}

/// New ids must be unique and must not collide with an existing element or
/// track id (a colliding track id would append onto an existing track).
fn check_new_ids(tracks: &SceneTracks, new_ids: &[String]) -> Result<(), TimelineError> {
    let mut taken: std::collections::HashSet<&str> = std::collections::HashSet::new();
    for view in crate::placement::ordered_tracks(tracks) {
        taken.insert(view.id);
        taken.extend(view.elements.iter().map(|span| span.id));
    }
    for id in new_ids {
        if !taken.insert(id.as_str()) {
            return Err(TimelineError::duplicate_id(id));
        }
    }
    Ok(())
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
        TimelineOp::TrimElement {
            track_id,
            element_id,
            trim_start,
            trim_end,
            start_time,
            duration,
        } => trim::trim(
            tracks,
            track_id,
            element_id,
            *trim_start,
            *trim_end,
            *start_time,
            *duration,
            ids,
        ),
        TimelineOp::RetimeElement {
            track_id,
            element_id,
            retime,
        } => retime::retime(tracks, track_id, element_id, retime.as_ref(), ids),
        TimelineOp::MoveElement {
            source_track_id,
            target_track_id,
            element_id,
            new_start_time,
            create_track,
        } => move_element::move_element(
            tracks,
            source_track_id,
            target_track_id,
            element_id,
            *new_start_time,
            create_track.as_ref(),
        ),
        TimelineOp::DeleteElements { elements } => delete::delete(tracks, elements),
        TimelineOp::DuplicateElements { elements } => duplicate::duplicate(tracks, elements, ids),
        TimelineOp::UpdateElements { updates } => update::update(tracks, updates, ids),
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
        return Err(lookup::track_not_found(tracks, track_id, None));
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
        return Err(lookup::track_not_found(tracks, track_id, None));
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
        return Err(lookup::track_not_found(tracks, track_id, None));
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
