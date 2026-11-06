use super::{ElementType, TrackType};

pub fn track_type_for_element_type(element_type: ElementType) -> TrackType {
    match element_type {
        ElementType::Audio => TrackType::Audio,
        ElementType::Text => TrackType::Text,
        ElementType::Sticker | ElementType::Graphic => TrackType::Graphic,
        ElementType::Effect => TrackType::Effect,
        ElementType::Video | ElementType::Image => TrackType::Video,
    }
}

pub fn can_element_go_on_track(element_type: ElementType, track_type: TrackType) -> bool {
    track_type_for_element_type(element_type) == track_type
}

fn element_type_name(element_type: ElementType) -> &'static str {
    match element_type {
        ElementType::Audio => "audio",
        ElementType::Text => "text",
        ElementType::Sticker => "sticker",
        ElementType::Graphic => "graphic",
        ElementType::Effect => "effect",
        ElementType::Video => "video",
        ElementType::Image => "image",
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

/// `Ok(())` when valid, otherwise the TS error message.
pub fn validate_element_track_compatibility(
    element_type: ElementType,
    track_type: TrackType,
) -> Result<(), String> {
    if can_element_go_on_track(element_type, track_type) {
        return Ok(());
    }
    Err(format!(
        "{} elements cannot be placed on {} tracks",
        element_type_name(element_type),
        track_type_name(track_type)
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn maps_element_types_to_track_types() {
        assert!(can_element_go_on_track(
            ElementType::Image,
            TrackType::Video
        ));
        assert!(can_element_go_on_track(
            ElementType::Sticker,
            TrackType::Graphic
        ));
        assert!(!can_element_go_on_track(
            ElementType::Audio,
            TrackType::Video
        ));
        assert_eq!(
            validate_element_track_compatibility(ElementType::Text, TrackType::Audio),
            Err("text elements cannot be placed on audio tracks".to_string())
        );
    }
}
