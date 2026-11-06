use super::TrackType;
use crate::model::{
    AudioTrack, AudioTrackType, EffectTrack, EffectTrackType, GraphicTrack, GraphicTrackType,
    OverlayTrack, TextTrack, TextTrackType, TimelineTrack, VideoTrack, VideoTrackType,
};
use serde_json::Map;

pub fn default_track_name(track_type: TrackType) -> &'static str {
    match track_type {
        TrackType::Video => "Video track",
        TrackType::Text => "Text track",
        TrackType::Audio => "Audio track",
        TrackType::Graphic => "Graphic track",
        TrackType::Effect => "Effect track",
    }
}

/// Empty track with the same fields TS produces (`hidden` on every type but
/// audio, `muted` on video and audio).
pub fn build_empty_track(id: &str, track_type: TrackType, name: Option<&str>) -> TimelineTrack {
    let id = id.to_string();
    let name = name.unwrap_or(default_track_name(track_type)).to_string();
    match track_type {
        TrackType::Video => TimelineTrack::Video(VideoTrack {
            id,
            name,
            kind: VideoTrackType::Video,
            elements: Vec::new(),
            muted: false,
            hidden: false,
            extra: Map::new(),
        }),
        TrackType::Text => TimelineTrack::Text(TextTrack {
            id,
            name,
            kind: TextTrackType::Text,
            elements: Vec::new(),
            hidden: false,
            extra: Map::new(),
        }),
        TrackType::Audio => TimelineTrack::Audio(AudioTrack {
            id,
            name,
            kind: AudioTrackType::Audio,
            elements: Vec::new(),
            muted: false,
            extra: Map::new(),
        }),
        TrackType::Graphic => TimelineTrack::Graphic(GraphicTrack {
            id,
            name,
            kind: GraphicTrackType::Graphic,
            elements: Vec::new(),
            hidden: false,
            extra: Map::new(),
        }),
        TrackType::Effect => TimelineTrack::Effect(EffectTrack {
            id,
            name,
            kind: EffectTrackType::Effect,
            elements: Vec::new(),
            hidden: false,
            extra: Map::new(),
        }),
    }
}

/// Builds an empty overlay track; `None` for audio.
pub fn build_empty_overlay_track(
    id: &str,
    track_type: TrackType,
    name: Option<&str>,
) -> Option<OverlayTrack> {
    match build_empty_track(id, track_type, name) {
        TimelineTrack::Video(track) => Some(OverlayTrack::Video(track)),
        TimelineTrack::Text(track) => Some(OverlayTrack::Text(track)),
        TimelineTrack::Graphic(track) => Some(OverlayTrack::Graphic(track)),
        TimelineTrack::Effect(track) => Some(OverlayTrack::Effect(track)),
        TimelineTrack::Audio(_) => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn matches_ts_shapes() {
        let video = serde_json::to_value(build_empty_track("v", TrackType::Video, None)).unwrap();
        assert_eq!(
            video,
            serde_json::json!({"id":"v","name":"Video track","type":"video","elements":[],"hidden":false,"muted":false})
        );
        let audio = serde_json::to_value(build_empty_track("a", TrackType::Audio, None)).unwrap();
        assert_eq!(
            audio,
            serde_json::json!({"id":"a","name":"Audio track","type":"audio","elements":[],"muted":false})
        );
    }
}
