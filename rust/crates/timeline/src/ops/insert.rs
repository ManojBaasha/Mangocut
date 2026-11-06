//! Mirrors `InsertElementCommand` (apps/web/src/lib/commands/timeline/element/insert-element.ts).
//!
//! Id order matches TS: the element id is taken first (the command's
//! constructor), then a track id only if placement creates a track.
//!
//! Stays in TS: the first-visual-media canvas/fps side effect and the graphic
//! `definitionId` registry check.

use serde_json::{Map, Value};
use time::TICKS_PER_SECOND;

use super::{Applied, IdSource, InsertPlacement};
use crate::error::TimelineError;
use crate::model::{ElementRef, SceneTracks, Ticks, TimelineElement};
use crate::placement::{
    ElementType, PlacementResult, PlacementStrategy, PlacementSubject, PlacementTimeSpan,
    apply_placement, can_element_go_on_track, resolve_track_placement,
    validate_element_track_compatibility,
};

/// `5 * TICKS_PER_SECOND` (apps/web/src/lib/timeline/creation.ts).
const DEFAULT_NEW_ELEMENT_DURATION: f64 = (5 * TICKS_PER_SECOND) as f64;

pub(super) fn element_type(name: &str) -> Option<ElementType> {
    Some(match name {
        "audio" => ElementType::Audio,
        "text" => ElementType::Text,
        "sticker" => ElementType::Sticker,
        "graphic" => ElementType::Graphic,
        "effect" => ElementType::Effect,
        "video" => ElementType::Video,
        "image" => ElementType::Image,
        _ => return None,
    })
}

/// JS truthiness for a JSON value (`!x` is false).
fn truthy(value: Option<&Value>) -> bool {
    match value {
        None | Some(Value::Null) | Some(Value::Bool(false)) => false,
        Some(Value::String(s)) => !s.is_empty(),
        Some(Value::Number(n)) => n.as_f64().is_some_and(|n| n != 0.0 && !n.is_nan()),
        Some(_) => true,
    }
}

/// `validateElementBasics`, minus the graphic registry check.
fn validate_basics(element: &Map<String, Value>, kind: &str) -> Result<(), TimelineError> {
    let requires_media_id = kind == "video"
        || kind == "image"
        || (kind == "audio" && element.get("sourceType").and_then(Value::as_str) == Some("upload"));
    if requires_media_id && !element.contains_key("mediaId") {
        return Err(TimelineError::new(
            "missing_media_id",
            format!("{kind} element requires mediaId"),
        )
        .with_hint("import the media first and pass its id as mediaId"));
    }
    if kind == "audio"
        && element.get("sourceType").and_then(Value::as_str) == Some("library")
        && !truthy(element.get("sourceUrl"))
    {
        return Err(TimelineError::new(
            "missing_source_url",
            "library audio element must have sourceUrl",
        )
        .with_hint("pass the library sound's url as sourceUrl"));
    }
    if kind == "sticker" && !truthy(element.get("stickerId")) {
        return Err(TimelineError::new(
            "missing_sticker_id",
            "sticker element must have stickerId",
        )
        .with_hint("pass the sticker's id as stickerId"));
    }
    if kind == "text" && !truthy(element.get("content")) {
        return Err(
            TimelineError::new("missing_content", "text element must have content")
                .with_hint("pass the text to display as content"),
        );
    }
    if kind == "effect" && !truthy(element.get("effectType")) {
        return Err(TimelineError::new(
            "missing_effect_type",
            "effect element must have effectType",
        )
        .with_hint("pass the effect's type as effectType"));
    }
    Ok(())
}

fn invalid_element(message: impl Into<String>) -> TimelineError {
    TimelineError::new("invalid_element", message)
        .with_hint("pass a complete element of a known type with a numeric startTime")
}

fn number_or(element: &Map<String, Value>, key: &str, default: f64) -> Value {
    match element.get(key) {
        None | Some(Value::Null) => serde_json::json!(default),
        Some(value) => value.clone(),
    }
}

/// `buildElement`: spread the input, set the id, default the trims and duration.
fn build_element(element: &Map<String, Value>, id: &str) -> Map<String, Value> {
    let mut built = element.clone();
    built.insert("id".into(), Value::String(id.to_string()));
    built.insert("trimStart".into(), number_or(element, "trimStart", 0.0));
    built.insert("trimEnd".into(), number_or(element, "trimEnd", 0.0));
    built.insert(
        "duration".into(),
        number_or(element, "duration", DEFAULT_NEW_ELEMENT_DURATION),
    );
    built
}

fn ticks_field(element: &Map<String, Value>, key: &str) -> Result<Ticks, TimelineError> {
    element
        .get(key)
        .and_then(Value::as_f64)
        .map(Ticks)
        .ok_or_else(|| invalid_element(format!("element is missing a numeric {key}")))
}

/// TS logs and returns without editing; the op reports `changed: false`.
fn unchanged(message: String) -> Applied {
    Applied::summary(message)
}

pub(super) fn insert(
    tracks: &mut SceneTracks,
    element: &Value,
    placement: &InsertPlacement,
    ids: &mut IdSource,
) -> Result<Applied, TimelineError> {
    let map = element
        .as_object()
        .ok_or_else(|| invalid_element("element must be an object"))?;
    let kind = map
        .get("type")
        .and_then(Value::as_str)
        .ok_or_else(|| invalid_element("element is missing its type"))?;
    let element_type = element_type(kind)
        .ok_or_else(|| invalid_element(format!("unknown element type {kind}")))?;

    // TS takes the element id in the command constructor, before anything else.
    let element_id = ids.next()?;
    validate_basics(map, kind)?;

    let mut built = build_element(map, &element_id);
    let start_time = ticks_field(&built, "startTime")?;
    let duration = ticks_field(&built, "duration")?;

    if let InsertPlacement::Auto {
        track_type: Some(track_type),
        ..
    } = placement
        && !can_element_go_on_track(element_type, *track_type)
    {
        return Ok(unchanged(format!(
            "{kind} elements cannot be placed on {} tracks",
            super::track_type_name(*track_type)
        )));
    }

    let subject = match placement {
        InsertPlacement::Auto {
            track_type: Some(track_type),
            ..
        } => PlacementSubject::TrackType(*track_type),
        _ => PlacementSubject::ElementType(element_type),
    };
    let strategy = match placement {
        InsertPlacement::Explicit { track_id } => PlacementStrategy::Explicit {
            track_id: track_id.clone(),
        },
        InsertPlacement::Auto { .. } => PlacementStrategy::FirstAvailable,
    };
    let spans = [PlacementTimeSpan {
        start_time,
        duration,
        exclude_element_id: None,
    }];

    let Some(result) = resolve_track_placement(tracks, subject, &spans, &strategy) else {
        if let InsertPlacement::Explicit { track_id } = placement {
            let compat = crate::placement::ordered_tracks(tracks)
                .into_iter()
                .find(|view| view.id == track_id)
                .map(|view| validate_element_track_compatibility(element_type, view.track_type));
            return match compat {
                None => Err(TimelineError::track_not_found(track_id)),
                Some(Err(message)) => Ok(unchanged(message)),
                Some(Ok(())) => Ok(unchanged(format!("could not place on {track_id}"))),
            };
        }
        return Ok(unchanged("no placement found".to_string()));
    };

    if let PlacementResult::ExistingTrack {
        adjusted_start_time: Some(adjusted),
        ..
    } = &result
    {
        built.insert("startTime".into(), serde_json::json!(adjusted.get()));
    }

    let timeline_element: TimelineElement = serde_json::from_value(Value::Object(built))
        .map_err(|error| invalid_element(format!("element is malformed: {error}")))?;

    let insert_index_override = match placement {
        InsertPlacement::Auto { insert_index, .. } => *insert_index,
        InsertPlacement::Explicit { .. } => None,
    };
    let Some((updated, track_id)) = apply_placement(
        tracks,
        &result,
        vec![timeline_element],
        insert_index_override,
        || ids.next(),
    )?
    else {
        return Ok(unchanged("element could not be placed".to_string()));
    };

    *tracks = updated;
    let reference = ElementRef {
        track_id: track_id.clone(),
        element_id,
        extra: Default::default(),
    };
    Ok(Applied {
        select: vec![reference.clone()],
        created: vec![reference],
        summary: format!("inserted {kind} element on track {track_id}"),
    })
}

#[cfg(test)]
mod tests {
    use serde_json::{Value, json};

    use crate::{ApplyOpOptions, SceneTracks, TimelineOp, apply_op};

    fn empty_scene() -> SceneTracks {
        serde_json::from_value(json!({
            "overlay": [],
            "main": {"id": "main", "name": "Main Track", "type": "video",
                     "elements": [], "muted": false, "hidden": false},
            "audio": []
        }))
        .unwrap()
    }

    fn run(
        element: Value,
        placement: Value,
        ids: &[&str],
    ) -> Result<crate::OpOutput, crate::TimelineError> {
        let op: TimelineOp = serde_json::from_value(
            json!({"type": "insertElement", "element": element, "placement": placement}),
        )
        .unwrap();
        apply_op(ApplyOpOptions {
            tracks: empty_scene(),
            op,
            new_ids: ids.iter().map(|id| id.to_string()).collect(),
            ripple: false,
        })
    }

    fn auto() -> Value {
        json!({"mode": "auto"})
    }

    fn assert_code(element: Value, code: &str) {
        let error = run(element, auto(), &["e"]).unwrap_err();
        assert_eq!(error.code, code);
        assert!(error.hint.is_some(), "{code} needs a hint");
    }

    #[test]
    fn missing_media_id() {
        assert_code(json!({"type": "video", "startTime": 0}), "missing_media_id");
        assert_code(json!({"type": "image", "startTime": 0}), "missing_media_id");
        assert_code(
            json!({"type": "audio", "sourceType": "upload", "startTime": 0}),
            "missing_media_id",
        );
    }

    #[test]
    fn missing_source_url() {
        assert_code(
            json!({"type": "audio", "sourceType": "library", "startTime": 0}),
            "missing_source_url",
        );
        assert_code(
            json!({"type": "audio", "sourceType": "library", "sourceUrl": "", "startTime": 0}),
            "missing_source_url",
        );
    }

    #[test]
    fn missing_sticker_id() {
        assert_code(
            json!({"type": "sticker", "startTime": 0}),
            "missing_sticker_id",
        );
    }

    #[test]
    fn missing_content() {
        assert_code(
            json!({"type": "text", "content": "", "startTime": 0}),
            "missing_content",
        );
    }

    #[test]
    fn missing_effect_type() {
        assert_code(
            json!({"type": "effect", "startTime": 0}),
            "missing_effect_type",
        );
    }

    #[test]
    fn consumes_element_id_first_then_track_id() {
        let text = json!({
            "type": "text", "name": "T", "content": "Hi", "startTime": 0,
            "fontSize": 15, "fontFamily": "Arial", "color": "#fff",
            "background": {}, "textAlign": "center", "fontWeight": "normal",
            "fontStyle": "normal", "textDecoration": "none",
            "transform": {"scaleX": 1, "scaleY": 1, "position": {"x": 0, "y": 0}, "rotate": 0},
            "opacity": 1
        });
        let output = run(text.clone(), auto(), &["el", "track"]).unwrap();
        assert!(output.changed);
        assert_eq!(output.select[0].element_id, "el");
        assert_eq!(output.select[0].track_id, "track");
        assert_eq!(output.created, output.select);
        let value = serde_json::to_value(&output.tracks).unwrap();
        assert_eq!(value["overlay"][0]["elements"][0]["duration"], 600000);

        let error = run(text, auto(), &["el"]).unwrap_err();
        assert_eq!(error.code, "missing_ids");
    }

    #[test]
    fn auto_track_type_mismatch_is_a_no_op() {
        let output = run(
            json!({"type": "sticker", "stickerId": "s", "startTime": 0}),
            json!({"mode": "auto", "trackType": "audio"}),
            &["e"],
        )
        .unwrap();
        assert!(!output.changed);
    }

    #[test]
    fn explicit_missing_track_errors() {
        let error = run(
            json!({"type": "sticker", "stickerId": "s", "startTime": 0}),
            json!({"mode": "explicit", "trackId": "nope"}),
            &["e"],
        )
        .unwrap_err();
        assert_eq!(error.code, "track_not_found");
    }
}
