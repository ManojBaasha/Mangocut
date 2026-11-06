//! Serde types that match the serialized project JSON (`SerializedProject` in
//! `apps/web/src/services/storage/types.ts`) exactly.
//!
//! Design notes:
//! - Every struct carries a flattened `extra` map so unknown fields round-trip.
//! - Optional fields are skipped when `None`, so absent stays absent.
//! - Discriminated unions are untagged enums whose structs carry a single-value
//!   marker `type` field. That keeps `type` a real field on every struct (the
//!   main track and audio track elements are deserialized outside any tagged
//!   enum) and yields the same TypeScript shape as the app's own types.
//! - Times are integer ticks (`i64`). Other numbers are `f64`, serialized
//!   without a fractional part when integral (like `JSON.stringify`).
//! - `animations`, `effects`, `masks`, `params` and text `background` are opaque
//!   `serde_json::Value` until later phases give them structure.

use serde::{Deserialize, Deserializer, Serialize, Serializer};
use serde_json::{Map, Value};
use time::FrameRate;

/// Serializes integral `f64` values as JSON integers so output matches what
/// JavaScript writes (`1` rather than `1.0`).
mod js_number {
    use super::*;

    fn write<S: Serializer>(value: f64, serializer: S) -> Result<S::Ok, S::Error> {
        if value.is_finite() && value.fract() == 0.0 && value.abs() < 9_007_199_254_740_992.0 {
            serializer.serialize_i64(value as i64)
        } else {
            serializer.serialize_f64(value)
        }
    }

    pub fn serialize<S: Serializer>(value: &f64, serializer: S) -> Result<S::Ok, S::Error> {
        write(*value, serializer)
    }

    pub fn serialize_opt<S: Serializer>(
        value: &Option<f64>,
        serializer: S,
    ) -> Result<S::Ok, S::Error> {
        match value {
            Some(value) => write(*value, serializer),
            None => serializer.serialize_none(),
        }
    }
}

/// Distinguishes an absent field (`None`) from an explicit `null` (`Some(None)`).
mod nullable {
    use super::*;

    pub fn deserialize<'de, T, D>(deserializer: D) -> Result<Option<Option<T>>, D::Error>
    where
        T: Deserialize<'de>,
        D: Deserializer<'de>,
    {
        Option::<T>::deserialize(deserializer).map(Some)
    }
}

pub type Extra = Map<String, Value>;

/// Declares a single-value enum used as the `type` marker of a struct.
macro_rules! marker {
    ($name:ident, $variant:ident, $literal:literal) => {
        #[cfg_attr(feature = "wasm", derive(tsify_next::Tsify))]
        #[cfg_attr(feature = "wasm", tsify(into_wasm_abi, from_wasm_abi))]
        #[derive(Serialize, Deserialize, Clone, Copy, Debug, Default, Eq, PartialEq)]
        pub enum $name {
            #[default]
            #[serde(rename = $literal)]
            $variant,
        }
    };
}

marker!(VideoTrackType, Video, "video");
marker!(TextTrackType, Text, "text");
marker!(AudioTrackType, Audio, "audio");
marker!(GraphicTrackType, Graphic, "graphic");
marker!(EffectTrackType, Effect, "effect");

marker!(AudioElementType, Audio, "audio");
marker!(VideoElementType, Video, "video");
marker!(ImageElementType, Image, "image");
marker!(TextElementType, Text, "text");
marker!(StickerElementType, Sticker, "sticker");
marker!(GraphicElementType, Graphic, "graphic");
marker!(EffectElementType, Effect, "effect");

// ---------------------------------------------------------------------------
// Project
// ---------------------------------------------------------------------------

#[cfg_attr(feature = "wasm", derive(tsify_next::Tsify))]
#[cfg_attr(feature = "wasm", tsify(into_wasm_abi, from_wasm_abi))]
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Project {
    pub metadata: ProjectMetadata,
    pub scenes: Vec<Scene>,
    pub current_scene_id: String,
    pub settings: ProjectSettings,
    pub version: u32,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub timeline_view_state: Option<TimelineViewState>,
    #[serde(flatten)]
    pub extra: Extra,
}

#[cfg_attr(feature = "wasm", derive(tsify_next::Tsify))]
#[cfg_attr(feature = "wasm", tsify(into_wasm_abi, from_wasm_abi))]
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ProjectMetadata {
    pub id: String,
    pub name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub thumbnail: Option<String>,
    /// Ticks.
    pub duration: i64,
    /// ISO 8601 timestamp.
    pub created_at: String,
    /// ISO 8601 timestamp.
    pub updated_at: String,
    #[serde(flatten)]
    pub extra: Extra,
}

#[cfg_attr(feature = "wasm", derive(tsify_next::Tsify))]
#[cfg_attr(feature = "wasm", tsify(into_wasm_abi, from_wasm_abi))]
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct TimelineViewState {
    #[serde(serialize_with = "js_number::serialize")]
    pub zoom_level: f64,
    #[serde(serialize_with = "js_number::serialize")]
    pub scroll_left: f64,
    #[serde(serialize_with = "js_number::serialize")]
    pub playhead_time: f64,
    #[serde(flatten)]
    pub extra: Extra,
}

#[cfg_attr(feature = "wasm", derive(tsify_next::Tsify))]
#[cfg_attr(feature = "wasm", tsify(into_wasm_abi, from_wasm_abi))]
#[derive(Serialize, Deserialize, Clone, Copy, Debug, Eq, PartialEq)]
#[serde(rename_all = "camelCase")]
pub enum CanvasSizeMode {
    Preset,
    Custom,
}

#[cfg_attr(feature = "wasm", derive(tsify_next::Tsify))]
#[cfg_attr(feature = "wasm", tsify(into_wasm_abi, from_wasm_abi))]
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ProjectSettings {
    pub fps: FrameRate,
    pub canvas_size: CanvasSize,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub canvas_size_mode: Option<CanvasSizeMode>,
    /// `None` = absent, `Some(None)` = explicit `null`.
    #[serde(
        default,
        deserialize_with = "nullable::deserialize",
        skip_serializing_if = "Option::is_none"
    )]
    pub last_custom_canvas_size: Option<Option<CanvasSize>>,
    /// `None` = absent, `Some(None)` = explicit `null`.
    #[serde(
        default,
        deserialize_with = "nullable::deserialize",
        skip_serializing_if = "Option::is_none"
    )]
    pub original_canvas_size: Option<Option<CanvasSize>>,
    pub background: Background,
    #[serde(flatten)]
    pub extra: Extra,
}

#[cfg_attr(feature = "wasm", derive(tsify_next::Tsify))]
#[cfg_attr(feature = "wasm", tsify(into_wasm_abi, from_wasm_abi))]
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CanvasSize {
    #[serde(serialize_with = "js_number::serialize")]
    pub width: f64,
    #[serde(serialize_with = "js_number::serialize")]
    pub height: f64,
    #[serde(flatten)]
    pub extra: Extra,
}

#[cfg_attr(feature = "wasm", derive(tsify_next::Tsify))]
#[cfg_attr(feature = "wasm", tsify(into_wasm_abi, from_wasm_abi))]
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum Background {
    #[serde(rename = "color")]
    Color {
        color: String,
        #[serde(flatten)]
        extra: Extra,
    },
    #[serde(rename = "blur", rename_all = "camelCase")]
    Blur {
        #[serde(serialize_with = "js_number::serialize")]
        blur_intensity: f64,
        #[serde(flatten)]
        extra: Extra,
    },
}

// ---------------------------------------------------------------------------
// Scene
// ---------------------------------------------------------------------------

#[cfg_attr(feature = "wasm", derive(tsify_next::Tsify))]
#[cfg_attr(feature = "wasm", tsify(into_wasm_abi, from_wasm_abi))]
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Scene {
    pub id: String,
    pub name: String,
    pub is_main: bool,
    pub tracks: SceneTracks,
    pub bookmarks: Vec<Bookmark>,
    /// ISO 8601 timestamp.
    pub created_at: String,
    /// ISO 8601 timestamp.
    pub updated_at: String,
    #[serde(flatten)]
    pub extra: Extra,
}

#[cfg_attr(feature = "wasm", derive(tsify_next::Tsify))]
#[cfg_attr(feature = "wasm", tsify(into_wasm_abi, from_wasm_abi))]
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Bookmark {
    /// Ticks.
    pub time: i64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub note: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub color: Option<String>,
    /// Ticks.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub duration: Option<i64>,
    #[serde(flatten)]
    pub extra: Extra,
}

#[cfg_attr(feature = "wasm", derive(tsify_next::Tsify))]
#[cfg_attr(feature = "wasm", tsify(into_wasm_abi, from_wasm_abi))]
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ElementRef {
    pub track_id: String,
    pub element_id: String,
    #[serde(flatten)]
    pub extra: Extra,
}

// ---------------------------------------------------------------------------
// Tracks
// ---------------------------------------------------------------------------

#[cfg_attr(feature = "wasm", derive(tsify_next::Tsify))]
#[cfg_attr(feature = "wasm", tsify(into_wasm_abi, from_wasm_abi))]
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SceneTracks {
    pub overlay: Vec<OverlayTrack>,
    pub main: VideoTrack,
    pub audio: Vec<AudioTrack>,
    #[serde(flatten)]
    pub extra: Extra,
}

#[cfg_attr(feature = "wasm", derive(tsify_next::Tsify))]
#[cfg_attr(feature = "wasm", tsify(into_wasm_abi, from_wasm_abi))]
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(untagged)]
pub enum TimelineTrack {
    Video(VideoTrack),
    Text(TextTrack),
    Audio(AudioTrack),
    Graphic(GraphicTrack),
    Effect(EffectTrack),
}

#[cfg_attr(feature = "wasm", derive(tsify_next::Tsify))]
#[cfg_attr(feature = "wasm", tsify(into_wasm_abi, from_wasm_abi))]
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(untagged)]
pub enum OverlayTrack {
    Video(VideoTrack),
    Text(TextTrack),
    Graphic(GraphicTrack),
    Effect(EffectTrack),
}

#[cfg_attr(feature = "wasm", derive(tsify_next::Tsify))]
#[cfg_attr(feature = "wasm", tsify(into_wasm_abi, from_wasm_abi))]
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct VideoTrack {
    pub id: String,
    pub name: String,
    #[serde(rename = "type")]
    pub kind: VideoTrackType,
    pub elements: Vec<VideoTrackElement>,
    pub muted: bool,
    pub hidden: bool,
    #[serde(flatten)]
    pub extra: Extra,
}

#[cfg_attr(feature = "wasm", derive(tsify_next::Tsify))]
#[cfg_attr(feature = "wasm", tsify(into_wasm_abi, from_wasm_abi))]
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct TextTrack {
    pub id: String,
    pub name: String,
    #[serde(rename = "type")]
    pub kind: TextTrackType,
    pub elements: Vec<TextElement>,
    pub hidden: bool,
    #[serde(flatten)]
    pub extra: Extra,
}

#[cfg_attr(feature = "wasm", derive(tsify_next::Tsify))]
#[cfg_attr(feature = "wasm", tsify(into_wasm_abi, from_wasm_abi))]
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AudioTrack {
    pub id: String,
    pub name: String,
    #[serde(rename = "type")]
    pub kind: AudioTrackType,
    pub elements: Vec<AudioElement>,
    pub muted: bool,
    #[serde(flatten)]
    pub extra: Extra,
}

#[cfg_attr(feature = "wasm", derive(tsify_next::Tsify))]
#[cfg_attr(feature = "wasm", tsify(into_wasm_abi, from_wasm_abi))]
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct GraphicTrack {
    pub id: String,
    pub name: String,
    #[serde(rename = "type")]
    pub kind: GraphicTrackType,
    pub elements: Vec<GraphicTrackElement>,
    pub hidden: bool,
    #[serde(flatten)]
    pub extra: Extra,
}

#[cfg_attr(feature = "wasm", derive(tsify_next::Tsify))]
#[cfg_attr(feature = "wasm", tsify(into_wasm_abi, from_wasm_abi))]
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct EffectTrack {
    pub id: String,
    pub name: String,
    #[serde(rename = "type")]
    pub kind: EffectTrackType,
    pub elements: Vec<EffectElement>,
    pub hidden: bool,
    #[serde(flatten)]
    pub extra: Extra,
}

/// Elements allowed on a video track.
#[cfg_attr(feature = "wasm", derive(tsify_next::Tsify))]
#[cfg_attr(feature = "wasm", tsify(into_wasm_abi, from_wasm_abi))]
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(untagged)]
pub enum VideoTrackElement {
    Video(VideoElement),
    Image(ImageElement),
}

/// Elements allowed on a graphic track.
#[cfg_attr(feature = "wasm", derive(tsify_next::Tsify))]
#[cfg_attr(feature = "wasm", tsify(into_wasm_abi, from_wasm_abi))]
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(untagged)]
pub enum GraphicTrackElement {
    Sticker(StickerElement),
    Graphic(GraphicElement),
}

// ---------------------------------------------------------------------------
// Elements
// ---------------------------------------------------------------------------

#[cfg_attr(feature = "wasm", derive(tsify_next::Tsify))]
#[cfg_attr(feature = "wasm", tsify(into_wasm_abi, from_wasm_abi))]
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(untagged)]
pub enum TimelineElement {
    Audio(AudioElement),
    Video(VideoElement),
    Image(ImageElement),
    Text(TextElement),
    Sticker(StickerElement),
    Graphic(GraphicElement),
    Effect(EffectElement),
}

#[cfg_attr(feature = "wasm", derive(tsify_next::Tsify))]
#[cfg_attr(feature = "wasm", tsify(into_wasm_abi, from_wasm_abi))]
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Transform {
    #[serde(serialize_with = "js_number::serialize")]
    pub scale_x: f64,
    #[serde(serialize_with = "js_number::serialize")]
    pub scale_y: f64,
    pub position: Position,
    #[serde(serialize_with = "js_number::serialize")]
    pub rotate: f64,
    #[serde(flatten)]
    pub extra: Extra,
}

#[cfg_attr(feature = "wasm", derive(tsify_next::Tsify))]
#[cfg_attr(feature = "wasm", tsify(into_wasm_abi, from_wasm_abi))]
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct Position {
    #[serde(serialize_with = "js_number::serialize")]
    pub x: f64,
    #[serde(serialize_with = "js_number::serialize")]
    pub y: f64,
    #[serde(flatten)]
    pub extra: Extra,
}

#[cfg_attr(feature = "wasm", derive(tsify_next::Tsify))]
#[cfg_attr(feature = "wasm", tsify(into_wasm_abi, from_wasm_abi))]
#[derive(Serialize, Deserialize, Clone, Copy, Debug, Eq, PartialEq)]
#[serde(rename_all = "kebab-case")]
pub enum BlendMode {
    Normal,
    Darken,
    Multiply,
    ColorBurn,
    Lighten,
    Screen,
    PlusLighter,
    ColorDodge,
    Overlay,
    SoftLight,
    HardLight,
    Difference,
    Exclusion,
    Hue,
    Saturation,
    Color,
    Luminosity,
}

#[cfg_attr(feature = "wasm", derive(tsify_next::Tsify))]
#[cfg_attr(feature = "wasm", tsify(into_wasm_abi, from_wasm_abi))]
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct RetimeConfig {
    #[serde(serialize_with = "js_number::serialize")]
    pub rate: f64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub maintain_pitch: Option<bool>,
    #[serde(flatten)]
    pub extra: Extra,
}

/// Where an audio element's samples come from (`sourceType` discriminator).
///
/// Each variant owns the flattened `extra` map for the whole audio element: a
/// struct cannot flatten both this enum and its own `extra` without both
/// capturing every unmatched key. Use [`AudioElement::extra`] to reach it.
#[cfg_attr(feature = "wasm", derive(tsify_next::Tsify))]
#[cfg_attr(feature = "wasm", tsify(into_wasm_abi, from_wasm_abi))]
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(tag = "sourceType", rename_all = "camelCase")]
pub enum AudioSource {
    #[serde(rename = "upload", rename_all = "camelCase")]
    Upload {
        media_id: String,
        #[serde(flatten)]
        extra: Extra,
    },
    #[serde(rename = "library", rename_all = "camelCase")]
    Library {
        source_url: String,
        #[serde(flatten)]
        extra: Extra,
    },
}

/// `buffer` (decoded audio) is runtime-only and never serialized.
#[cfg_attr(feature = "wasm", derive(tsify_next::Tsify))]
#[cfg_attr(feature = "wasm", tsify(into_wasm_abi, from_wasm_abi))]
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AudioElement {
    pub id: String,
    #[serde(rename = "type")]
    pub kind: AudioElementType,
    pub name: String,
    /// Ticks.
    pub duration: i64,
    /// Ticks.
    pub start_time: i64,
    /// Ticks.
    pub trim_start: i64,
    /// Ticks.
    pub trim_end: i64,
    /// Ticks.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub source_duration: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub animations: Option<Value>,
    #[serde(serialize_with = "js_number::serialize")]
    pub volume: f64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub muted: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub retime: Option<RetimeConfig>,
    /// Flattened `sourceType` discriminator, source fields and unknown fields.
    #[serde(flatten)]
    pub source: AudioSource,
}

impl AudioElement {
    pub fn extra(&self) -> &Extra {
        match &self.source {
            AudioSource::Upload { extra, .. } | AudioSource::Library { extra, .. } => extra,
        }
    }

    pub fn extra_mut(&mut self) -> &mut Extra {
        match &mut self.source {
            AudioSource::Upload { extra, .. } | AudioSource::Library { extra, .. } => extra,
        }
    }
}

#[cfg_attr(feature = "wasm", derive(tsify_next::Tsify))]
#[cfg_attr(feature = "wasm", tsify(into_wasm_abi, from_wasm_abi))]
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct VideoElement {
    pub id: String,
    #[serde(rename = "type")]
    pub kind: VideoElementType,
    pub name: String,
    /// Ticks.
    pub duration: i64,
    /// Ticks.
    pub start_time: i64,
    /// Ticks.
    pub trim_start: i64,
    /// Ticks.
    pub trim_end: i64,
    /// Ticks.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub source_duration: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub animations: Option<Value>,
    pub media_id: String,
    #[serde(
        default,
        serialize_with = "js_number::serialize_opt",
        skip_serializing_if = "Option::is_none"
    )]
    pub volume: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub muted: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub is_source_audio_enabled: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub hidden: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub retime: Option<RetimeConfig>,
    pub transform: Transform,
    #[serde(serialize_with = "js_number::serialize")]
    pub opacity: f64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub blend_mode: Option<BlendMode>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub effects: Option<Value>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub masks: Option<Value>,
    #[serde(flatten)]
    pub extra: Extra,
}

#[cfg_attr(feature = "wasm", derive(tsify_next::Tsify))]
#[cfg_attr(feature = "wasm", tsify(into_wasm_abi, from_wasm_abi))]
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ImageElement {
    pub id: String,
    #[serde(rename = "type")]
    pub kind: ImageElementType,
    pub name: String,
    /// Ticks.
    pub duration: i64,
    /// Ticks.
    pub start_time: i64,
    /// Ticks.
    pub trim_start: i64,
    /// Ticks.
    pub trim_end: i64,
    /// Ticks.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub source_duration: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub animations: Option<Value>,
    pub media_id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub hidden: Option<bool>,
    pub transform: Transform,
    #[serde(serialize_with = "js_number::serialize")]
    pub opacity: f64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub blend_mode: Option<BlendMode>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub effects: Option<Value>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub masks: Option<Value>,
    #[serde(flatten)]
    pub extra: Extra,
}

#[cfg_attr(feature = "wasm", derive(tsify_next::Tsify))]
#[cfg_attr(feature = "wasm", tsify(into_wasm_abi, from_wasm_abi))]
#[derive(Serialize, Deserialize, Clone, Copy, Debug, Eq, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum TextAlign {
    Left,
    Center,
    Right,
}

#[cfg_attr(feature = "wasm", derive(tsify_next::Tsify))]
#[cfg_attr(feature = "wasm", tsify(into_wasm_abi, from_wasm_abi))]
#[derive(Serialize, Deserialize, Clone, Copy, Debug, Eq, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum FontWeight {
    Normal,
    Bold,
}

#[cfg_attr(feature = "wasm", derive(tsify_next::Tsify))]
#[cfg_attr(feature = "wasm", tsify(into_wasm_abi, from_wasm_abi))]
#[derive(Serialize, Deserialize, Clone, Copy, Debug, Eq, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum FontStyle {
    Normal,
    Italic,
}

#[cfg_attr(feature = "wasm", derive(tsify_next::Tsify))]
#[cfg_attr(feature = "wasm", tsify(into_wasm_abi, from_wasm_abi))]
#[derive(Serialize, Deserialize, Clone, Copy, Debug, Eq, PartialEq)]
#[serde(rename_all = "kebab-case")]
pub enum TextDecoration {
    None,
    Underline,
    LineThrough,
}

#[cfg_attr(feature = "wasm", derive(tsify_next::Tsify))]
#[cfg_attr(feature = "wasm", tsify(into_wasm_abi, from_wasm_abi))]
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct TextElement {
    pub id: String,
    #[serde(rename = "type")]
    pub kind: TextElementType,
    pub name: String,
    /// Ticks.
    pub duration: i64,
    /// Ticks.
    pub start_time: i64,
    /// Ticks.
    pub trim_start: i64,
    /// Ticks.
    pub trim_end: i64,
    /// Ticks.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub source_duration: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub animations: Option<Value>,
    pub content: String,
    #[serde(serialize_with = "js_number::serialize")]
    pub font_size: f64,
    pub font_family: String,
    pub color: String,
    /// Opaque `TextBackground` object.
    pub background: Value,
    pub text_align: TextAlign,
    pub font_weight: FontWeight,
    pub font_style: FontStyle,
    pub text_decoration: TextDecoration,
    #[serde(
        default,
        serialize_with = "js_number::serialize_opt",
        skip_serializing_if = "Option::is_none"
    )]
    pub letter_spacing: Option<f64>,
    #[serde(
        default,
        serialize_with = "js_number::serialize_opt",
        skip_serializing_if = "Option::is_none"
    )]
    pub line_height: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub hidden: Option<bool>,
    pub transform: Transform,
    #[serde(serialize_with = "js_number::serialize")]
    pub opacity: f64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub blend_mode: Option<BlendMode>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub effects: Option<Value>,
    #[serde(flatten)]
    pub extra: Extra,
}

#[cfg_attr(feature = "wasm", derive(tsify_next::Tsify))]
#[cfg_attr(feature = "wasm", tsify(into_wasm_abi, from_wasm_abi))]
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct StickerElement {
    pub id: String,
    #[serde(rename = "type")]
    pub kind: StickerElementType,
    pub name: String,
    /// Ticks.
    pub duration: i64,
    /// Ticks.
    pub start_time: i64,
    /// Ticks.
    pub trim_start: i64,
    /// Ticks.
    pub trim_end: i64,
    /// Ticks.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub source_duration: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub animations: Option<Value>,
    pub sticker_id: String,
    #[serde(
        default,
        serialize_with = "js_number::serialize_opt",
        skip_serializing_if = "Option::is_none"
    )]
    pub intrinsic_width: Option<f64>,
    #[serde(
        default,
        serialize_with = "js_number::serialize_opt",
        skip_serializing_if = "Option::is_none"
    )]
    pub intrinsic_height: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub hidden: Option<bool>,
    pub transform: Transform,
    #[serde(serialize_with = "js_number::serialize")]
    pub opacity: f64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub blend_mode: Option<BlendMode>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub effects: Option<Value>,
    #[serde(flatten)]
    pub extra: Extra,
}

#[cfg_attr(feature = "wasm", derive(tsify_next::Tsify))]
#[cfg_attr(feature = "wasm", tsify(into_wasm_abi, from_wasm_abi))]
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct GraphicElement {
    pub id: String,
    #[serde(rename = "type")]
    pub kind: GraphicElementType,
    pub name: String,
    /// Ticks.
    pub duration: i64,
    /// Ticks.
    pub start_time: i64,
    /// Ticks.
    pub trim_start: i64,
    /// Ticks.
    pub trim_end: i64,
    /// Ticks.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub source_duration: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub animations: Option<Value>,
    pub definition_id: String,
    /// Opaque `ParamValues` object.
    pub params: Value,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub hidden: Option<bool>,
    pub transform: Transform,
    #[serde(serialize_with = "js_number::serialize")]
    pub opacity: f64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub blend_mode: Option<BlendMode>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub effects: Option<Value>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub masks: Option<Value>,
    #[serde(flatten)]
    pub extra: Extra,
}

#[cfg_attr(feature = "wasm", derive(tsify_next::Tsify))]
#[cfg_attr(feature = "wasm", tsify(into_wasm_abi, from_wasm_abi))]
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct EffectElement {
    pub id: String,
    #[serde(rename = "type")]
    pub kind: EffectElementType,
    pub name: String,
    /// Ticks.
    pub duration: i64,
    /// Ticks.
    pub start_time: i64,
    /// Ticks.
    pub trim_start: i64,
    /// Ticks.
    pub trim_end: i64,
    /// Ticks.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub source_duration: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub animations: Option<Value>,
    pub effect_type: String,
    /// Opaque `ParamValues` object.
    pub params: Value,
    #[serde(flatten)]
    pub extra: Extra,
}
