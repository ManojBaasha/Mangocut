//! The error contract: bad input gives a typed, actionable error, never a panic.

use std::panic::{AssertUnwindSafe, catch_unwind};

use serde_json::{Value, json};
use timeline::{
    ApplyOpOptions, SceneTracks, Ticks, TimelineError, TimelineOp, ValidateOptions, apply_op,
    validate_tracks,
};

const TRANSFORM: &str = r#"{"scaleX":1,"scaleY":1,"position":{"x":0,"y":0},"rotate":0}"#;

fn video(id: &str, start: f64, duration: f64) -> Value {
    json!({
        "type": "video", "id": id, "mediaId": "m", "name": "clip", "duration": duration,
        "startTime": start, "trimStart": 0, "trimEnd": 0, "sourceDuration": duration,
        "muted": false, "isSourceAudioEnabled": true, "hidden": false,
        "transform": serde_json::from_str::<Value>(TRANSFORM).unwrap(),
        "opacity": 1, "blendMode": "normal", "volume": 0
    })
}

fn text(id: &str, start: f64, duration: f64) -> Value {
    json!({
        "type": "text", "id": id, "name": "T", "content": "Hi", "duration": duration,
        "startTime": start, "trimStart": 0, "trimEnd": 0, "fontSize": 15,
        "fontFamily": "Arial", "color": "#fff", "background": {}, "textAlign": "center",
        "fontWeight": "normal", "fontStyle": "normal", "textDecoration": "none",
        "transform": serde_json::from_str::<Value>(TRANSFORM).unwrap(), "opacity": 1
    })
}

fn audio(id: &str, start: f64, duration: f64) -> Value {
    json!({
        "type": "audio", "sourceType": "library", "sourceUrl": "https://x/a.mp3",
        "id": id, "name": "Song", "duration": duration, "startTime": start,
        "trimStart": 0, "trimEnd": 0, "volume": 1
    })
}

fn scene(main: Vec<Value>, overlay: Vec<Value>, audio_elements: Vec<Value>) -> SceneTracks {
    serde_json::from_value(json!({
        "overlay": overlay,
        "main": {"id": "main", "name": "Main", "type": "video", "muted": false,
                 "hidden": false, "elements": main},
        "audio": [{"id": "audio-1", "name": "Audio", "type": "audio", "muted": false,
                   "elements": audio_elements}]
    }))
    .unwrap()
}

fn text_track(elements: Vec<Value>) -> Value {
    json!({"id": "text-1", "name": "Text", "type": "text", "hidden": false, "elements": elements})
}

fn base_tracks() -> SceneTracks {
    scene(
        vec![video("el1", 0.0, 1000.0), video("el2", 1000.0, 1000.0)],
        vec![text_track(vec![text("tx1", 0.0, 500.0)])],
        vec![audio("au1", 0.0, 800.0)],
    )
}

fn op(value: Value) -> TimelineOp {
    serde_json::from_value(value).unwrap()
}

fn run(
    tracks: SceneTracks,
    op: TimelineOp,
    ids: &[&str],
) -> Result<timeline::OpOutput, TimelineError> {
    apply_op(ApplyOpOptions {
        tracks,
        op,
        new_ids: ids.iter().map(|id| id.to_string()).collect(),
        ripple: false,
        validate: true,
    })
}

fn error_of(op: TimelineOp, ids: &[&str]) -> TimelineError {
    run(base_tracks(), op, ids).unwrap_err()
}

#[test]
fn errors_are_typed_not_panics() {
    let cases = [
        (
            op(json!({"type": "splitElements", "splitTime": 10,
                "elements": [{"trackId": "main", "elementId": "missing-el"}]})),
            vec!["r"],
            "element_not_found",
        ),
        (
            op(json!({"type": "moveElement", "sourceTrackId": "main",
                "targetTrackId": "missing-track", "elementId": "el1", "newStartTime": 0})),
            vec![],
            "track_not_found",
        ),
        (
            op(json!({"type": "trimElement", "trackId": "main", "elementId": "el1", "trimStart": -5, "trimEnd": 0})),
            vec![],
            "invalid_trim",
        ),
        (
            op(json!({"type": "trimElement", "trackId": "missing-track", "elementId": "el1",
                "trimStart": 0, "trimEnd": 0})),
            vec![],
            "track_not_found",
        ),
        // el1 exists, but on main, not on the named track.
        (
            op(json!({"type": "trimElement", "trackId": "text-1", "elementId": "el1",
                "trimStart": 0, "trimEnd": 0})),
            vec![],
            "element_not_found",
        ),
        // A text element moved onto an audio track.
        (
            op(json!({"type": "moveElement", "sourceTrackId": "text-1",
                "targetTrackId": "audio-1", "elementId": "tx1", "newStartTime": 0})),
            vec![],
            "incompatible_track",
        ),
        (
            op(json!({"type": "insertElement",
                "element": {"type": "video", "mediaId": "m", "startTime": 0},
                "placement": {"mode": "auto"}})),
            vec![],
            "missing_ids",
        ),
        (
            op(json!({"type": "removeTrack", "trackId": "missing-track"})),
            vec![],
            "track_not_found",
        ),
        (
            op(json!({"type": "duplicateElements",
                "elements": [{"trackId": "main", "elementId": "missing-el"}]})),
            vec!["c", "t"],
            "element_not_found",
        ),
    ];
    for (op, ids, code) in cases {
        let err = error_of(op, &ids);
        assert_eq!(err.code, code, "{err:?}");
        assert!(err.hint.is_some(), "{code} needs a hint");
    }
}

#[test]
fn hints_name_valid_values() {
    let err = error_of(
        op(json!({"type": "trimElement", "trackId": "main", "elementId": "el1", "trimStart": 600, "trimEnd": 600})),
        &[],
    );
    assert_eq!(err.code, "invalid_trim");
    assert!(
        err.hint.unwrap().contains("1000"),
        "hint names the source duration"
    );

    let err = error_of(
        op(json!({"type": "moveElement", "sourceTrackId": "main",
            "targetTrackId": "audio-1", "elementId": "el1", "newStartTime": 0})),
        &[],
    );
    assert_eq!(err.code, "incompatible_track");
    assert!(
        err.hint.unwrap().contains("main"),
        "hint lists video track ids"
    );

    let err = error_of(
        op(json!({"type": "moveElement", "sourceTrackId": "main",
            "targetTrackId": "nope", "elementId": "el1", "newStartTime": 0})),
        &[],
    );
    let hint = err.hint.unwrap();
    assert!(
        hint.contains("audio-1") && hint.contains("text-1"),
        "{hint}"
    );

    let err = error_of(
        op(json!({"type": "deleteElements",
            "elements": [{"trackId": "main", "elementId": "nope"}]})),
        &[],
    );
    assert!(err.hint.unwrap().contains("el1"));
}

#[test]
fn incompatible_insert_stays_a_ts_style_no_op() {
    let output = run(
        base_tracks(),
        op(json!({"type": "insertElement",
            "element": {"type": "text", "content": "x", "startTime": 0},
            "placement": {"mode": "explicit", "trackId": "audio-1"}})),
        &["e"],
    )
    .unwrap();
    assert!(!output.changed);
}

#[test]
fn overlap_introduced_by_update_is_rejected() {
    let err = error_of(
        op(json!({"type": "updateElements", "updates": [
            {"trackId": "main", "elementId": "el2", "patch": {"startTime": 500}}]})),
        &[],
    );
    assert_eq!(err.code, "invalid_result");
    assert!(err.message.contains("overlap"), "{}", err.message);
    assert!(err.hint.is_some());
}

#[test]
fn validate_false_accepts_an_overlapping_result() {
    // Slowing el1 to 0.5x doubles it onto el2.
    let slow = || {
        op(json!({"type": "updateElements", "updates": [
            {"trackId": "main", "elementId": "el1", "patch": {"retime": {"rate": 0.5}}}]}))
    };
    let run_with = |validate: bool| {
        apply_op(ApplyOpOptions {
            tracks: base_tracks(),
            op: slow(),
            new_ids: vec![],
            ripple: false,
            validate,
        })
    };
    let strict = run_with(true).unwrap_err();
    assert_eq!(strict.code, "invalid_result");

    let output = run_with(false).unwrap();
    assert!(output.changed);
    let value = serde_json::to_value(&output.tracks).unwrap();
    assert_eq!(value["main"]["elements"][0]["duration"], 2000);
    assert_eq!(value["main"]["elements"][0]["retime"]["rate"], 0.5);

    // validate=false skips only the result check: op errors still apply.
    let unknown = apply_op(ApplyOpOptions {
        tracks: base_tracks(),
        op: op(json!({"type": "updateElements", "updates": [
            {"trackId": "main", "elementId": "nope", "patch": {"opacity": 0}}]})),
        new_ids: vec![],
        ripple: false,
        validate: false,
    })
    .unwrap_err();
    assert_eq!(unknown.code, "element_not_found");
}

#[test]
fn validate_defaults_to_true_when_omitted() {
    let options: ApplyOpOptions = serde_json::from_value(json!({
        "tracks": serde_json::to_value(base_tracks()).unwrap(),
        "op": {"type": "toggleTrackMute", "trackId": "main"}
    }))
    .unwrap();
    assert!(options.validate);
}

#[test]
fn only_new_violations_are_blamed() {
    // The input already overlaps; an unrelated edit must still go through.
    let broken = scene(
        vec![video("el1", 0.0, 1000.0), video("el2", 500.0, 1000.0)],
        vec![],
        vec![audio("au1", 0.0, 800.0)],
    );
    assert!(
        !validate_tracks(ValidateOptions {
            tracks: broken.clone()
        })
        .is_empty()
    );
    let output = run(
        broken.clone(),
        op(json!({"type": "toggleTrackMute", "trackId": "audio-1"})),
        &[],
    )
    .unwrap();
    assert!(output.changed);
    // A new overlap elsewhere is still blamed.
    let err = run(
        broken,
        op(json!({"type": "updateElements", "updates": [
            {"trackId": "audio-1", "elementId": "au1", "patch": {"duration": 0}}]})),
        &[],
    )
    .unwrap_err();
    assert_eq!(err.code, "invalid_result");
}

#[test]
fn validate_tracks_reports_each_invariant() {
    let tracks = scene(
        vec![
            video("a", 0.0, 100.0),
            video("b", 50.0, 100.0),
            video("zero", 300.0, 0.0),
        ],
        vec![],
        vec![],
    );
    let codes: Vec<String> = validate_tracks(ValidateOptions { tracks })
        .into_iter()
        .map(|e| e.code)
        .collect();
    assert!(codes.contains(&"overlap".to_string()));
    assert!(codes.contains(&"invalid_duration".to_string()));

    let mut trimmed = base_tracks();
    let mut value = serde_json::to_value(&trimmed).unwrap();
    value["main"]["elements"][0]["trimStart"] = json!(600);
    value["main"]["elements"][0]["trimEnd"] = json!(600);
    value["main"]["elements"][1]["trimEnd"] = json!(-1);
    trimmed = serde_json::from_value(value).unwrap();
    let errors = validate_tracks(ValidateOptions { tracks: trimmed });
    assert_eq!(
        errors.iter().filter(|e| e.code == "invalid_trim").count(),
        2
    );
    assert!(errors.iter().all(|e| e.hint.is_some()));

    assert!(
        validate_tracks(ValidateOptions {
            tracks: base_tracks()
        })
        .is_empty()
    );
}

#[test]
fn colliding_new_ids_are_rejected() {
    let insert = || {
        let mut element = text("ignored", 5000.0, 100.0);
        element.as_object_mut().unwrap().remove("id");
        op(json!({"type": "insertElement", "element": element,
            "placement": {"mode": "auto"}}))
    };
    // Collides with an element id, a track id, and itself.
    for ids in [
        vec!["el1", "t"],
        vec!["new", "text-1"],
        vec!["same", "same"],
    ] {
        let err = error_of(insert(), &ids);
        assert_eq!(err.code, "duplicate_id", "{ids:?}");
        assert!(err.hint.is_some());
    }
    assert!(run(base_tracks(), insert(), &["new", "fresh"]).is_ok());
}

#[test]
fn ripple_propagates_instead_of_swallowing() {
    // Smoke: ripple on a valid delete still works end to end.
    let output = apply_op(ApplyOpOptions {
        tracks: base_tracks(),
        op: op(json!({"type": "deleteElements",
            "elements": [{"trackId": "main", "elementId": "el1"}]})),
        new_ids: vec![],
        ripple: true,
        validate: true,
    })
    .unwrap();
    assert_eq!(output.tracks.main.elements.len(), 1);
}

// ---------------------------------------------------------------------------
// No-panic safety net
// ---------------------------------------------------------------------------

fn nan_tracks() -> SceneTracks {
    let mut tracks = base_tracks();
    if let timeline::VideoTrackElement::Video(el) = &mut tracks.main.elements[0] {
        el.start_time = Ticks(f64::NAN);
        el.duration = Ticks(f64::NAN);
        el.trim_start = Ticks(f64::NAN);
        el.trim_end = Ticks(f64::INFINITY);
        el.source_duration = Some(Ticks(f64::NAN));
    }
    tracks
}

fn zero_duration_tracks() -> SceneTracks {
    scene(
        vec![video("el1", 0.0, 0.0), video("el2", 0.0, 0.0)],
        vec![text_track(vec![text("tx1", 0.0, 0.0)])],
        vec![audio("au1", 0.0, 0.0)],
    )
}

fn empty_tracks() -> SceneTracks {
    scene(vec![], vec![], vec![])
}

fn every_op() -> Vec<TimelineOp> {
    let refs = |track: &str, element: &str| json!([{"trackId": track, "elementId": element}]);
    let mut ops = Vec::new();
    for (track, element) in [
        ("main", "el1"),
        ("main", "nope"),
        ("nope", "el1"),
        ("text-1", "tx1"),
    ] {
        ops.extend([
            json!({"type": "splitElements", "elements": refs(track, element), "splitTime": 10}),
            json!({"type": "splitElements", "elements": refs(track, element), "splitTime": 0,
                "retainSide": "left"}),
            json!({"type": "trimElement", "trackId": track, "elementId": element, "trimStart": 5, "trimEnd": 5}),
            json!({"type": "trimElement", "trackId": track, "elementId": element, "trimStart": 0, "trimEnd": 0,
                "startTime": 3, "duration": 0}),
            json!({"type": "retimeElement", "trackId": track, "elementId": element,
                "retime": {"rate": 0}}),
            json!({"type": "retimeElement", "trackId": track, "elementId": element}),
            json!({"type": "moveElement", "sourceTrackId": track, "targetTrackId": "audio-1",
                "elementId": element, "newStartTime": 5}),
            json!({"type": "moveElement", "sourceTrackId": track, "targetTrackId": track,
                "elementId": element, "newStartTime": -5}),
            json!({"type": "moveElement", "sourceTrackId": track, "targetTrackId": "new-t",
                "elementId": element, "newStartTime": 0,
                "createTrack": {"type": "audio", "index": 99999}}),
            json!({"type": "deleteElements", "elements": refs(track, element)}),
            json!({"type": "duplicateElements", "elements": refs(track, element)}),
            json!({"type": "updateElements", "updates": [{"trackId": track,
                "elementId": element, "patch": {"duration": 0, "startTime": 1e300}}]}),
            json!({"type": "updateElements", "updates": [{"trackId": track,
                "elementId": element, "patch": {"retime": {"rate": 1e-300}}}]}),
        ]);
    }
    for track_type in ["video", "text", "audio", "graphic", "effect"] {
        ops.push(json!({"type": "addTrack", "trackType": track_type}));
        ops.push(
            json!({"type": "addTrack", "trackType": track_type, "index": 18446744073709551615u64}),
        );
    }
    for id in ["main", "audio-1", "text-1", "nope"] {
        ops.push(json!({"type": "removeTrack", "trackId": id}));
        ops.push(json!({"type": "toggleTrackMute", "trackId": id}));
        ops.push(json!({"type": "toggleTrackVisibility", "trackId": id}));
    }
    for kind in [
        "video", "image", "audio", "text", "sticker", "graphic", "effect", "bogus",
    ] {
        for placement in [
            json!({"mode": "auto"}),
            json!({"mode": "auto", "trackType": "audio", "insertIndex": 18446744073709551615u64}),
            json!({"mode": "explicit", "trackId": "main"}),
            json!({"mode": "explicit", "trackId": "nope"}),
        ] {
            ops.push(json!({"type": "insertElement", "placement": placement,
                "element": {"type": kind, "mediaId": "m", "content": "x", "stickerId": "s",
                    "effectType": "blur", "sourceType": "upload", "startTime": 0, "duration": 0}}));
        }
    }
    ops.push(json!({"type": "insertElement", "placement": {"mode": "auto"}, "element": 5}));
    ops.push(
        json!({"type": "insertElement", "placement": {"mode": "auto"},
        "element": {"type": "text", "content": "x", "startTime": "soon"}}),
    );
    let mut parsed: Vec<TimelineOp> = ops.into_iter().map(op).collect();
    let batch = TimelineOp::Batch {
        ops: parsed.clone(),
    };
    parsed.push(batch);
    // NaN ticks reach ops through the typed path (JSON cannot spell NaN).
    parsed.push(TimelineOp::SplitElements {
        elements: vec![timeline::ElementRef {
            track_id: "main".into(),
            element_id: "el1".into(),
            extra: Default::default(),
        }],
        split_time: Ticks(f64::NAN),
        retain_side: Default::default(),
    });
    parsed.push(TimelineOp::TrimElement {
        track_id: "main".into(),
        element_id: "el1".into(),
        trim_start: Ticks(f64::NAN),
        trim_end: Ticks(f64::NEG_INFINITY),
        start_time: Some(Ticks(f64::NAN)),
        duration: Some(Ticks(f64::NAN)),
    });
    parsed.push(TimelineOp::MoveElement {
        source_track_id: "main".into(),
        target_track_id: "main".into(),
        element_id: "el1".into(),
        new_start_time: Ticks(f64::NAN),
        create_track: None,
    });
    parsed
}

#[test]
fn malformed_inputs_never_panic() {
    let scenes: Vec<(&str, SceneTracks)> = vec![
        ("base", base_tracks()),
        ("nan", nan_tracks()),
        ("zero", zero_duration_tracks()),
        ("empty", empty_tracks()),
    ];
    let ops = every_op();
    let mut ran = 0;
    for (name, tracks) in &scenes {
        assert!(
            catch_unwind(|| validate_tracks(ValidateOptions {
                tracks: tracks.clone()
            }))
            .is_ok(),
            "validate_tracks panicked on {name}"
        );
        for (index, op) in ops.iter().enumerate() {
            for ripple in [false, true] {
                let outcome = catch_unwind(AssertUnwindSafe(|| {
                    apply_op(ApplyOpOptions {
                        tracks: tracks.clone(),
                        op: op.clone(),
                        new_ids: (0..8).map(|i| format!("gen-{i}")).collect(),
                        ripple,
                        validate: true,
                    })
                }));
                assert!(
                    outcome.is_ok(),
                    "apply_op panicked on scene {name}, op #{index} {op:?}, ripple {ripple}"
                );
                ran += 1;
            }
        }
    }
    assert!(ran > 800, "matrix should be large, ran {ran}");
}
