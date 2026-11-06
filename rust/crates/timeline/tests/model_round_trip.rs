use std::path::PathBuf;

use serde_json::Value;
use timeline::Project;

fn fixture_dir(name: &str) -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("tests/fixtures")
        .join(name)
}

fn fixture_paths(name: &str) -> Vec<PathBuf> {
    let mut paths: Vec<PathBuf> = std::fs::read_dir(fixture_dir(name))
        .unwrap()
        .map(|entry| entry.unwrap().path())
        .filter(|path| path.extension().is_some_and(|ext| ext == "json"))
        .collect();
    paths.sort();
    assert!(
        paths.len() >= 4,
        "expected at least 4 fixtures, got {paths:?}"
    );
    paths
}

fn read_json(path: &std::path::Path) -> Value {
    serde_json::from_str(&std::fs::read_to_string(path).unwrap()).unwrap()
}

#[test]
fn round_trip_is_lossless() {
    for path in fixture_paths("projects") {
        let raw: Value = read_json(&path);
        let project: Project = serde_json::from_value(raw.clone()).unwrap();
        assert_eq!(serde_json::to_value(&project).unwrap(), raw, "{path:?}");
    }
}

#[test]
fn round_trip_preserves_unknown_fields() {
    let raw = read_json(&fixture_dir("projects").join("unknown-fields.json"));
    let out =
        serde_json::to_value(serde_json::from_value::<Project>(raw.clone()).unwrap()).unwrap();
    assert_eq!(out["futureField"], raw["futureField"]);
    assert_eq!(
        out["scenes"][0]["tracks"]["main"]["elements"][0]["futureElementField"],
        raw["scenes"][0]["tracks"]["main"]["elements"][0]["futureElementField"]
    );
}

#[test]
fn known_fields_do_not_leak_into_extra() {
    use timeline::{AudioSource, OverlayTrack, VideoTrackElement};

    for path in fixture_paths("projects") {
        if path
            .file_name()
            .is_some_and(|name| name == "unknown-fields.json")
        {
            continue;
        }
        let project: Project = serde_json::from_value(read_json(&path)).unwrap();
        assert!(project.extra.is_empty(), "{path:?}");
        assert!(project.metadata.extra.is_empty(), "{path:?}");
        assert!(project.settings.extra.is_empty(), "{path:?}");
        for scene in &project.scenes {
            assert!(scene.extra.is_empty(), "{path:?}");
            assert!(scene.tracks.extra.is_empty(), "{path:?}");
            assert!(scene.tracks.main.extra.is_empty(), "{path:?}");
            for element in &scene.tracks.main.elements {
                match element {
                    VideoTrackElement::Video(e) => {
                        assert!(
                            e.extra.is_empty() && e.transform.extra.is_empty(),
                            "{path:?}"
                        )
                    }
                    VideoTrackElement::Image(e) => assert!(e.extra.is_empty(), "{path:?}"),
                }
            }
            for track in &scene.tracks.overlay {
                match track {
                    OverlayTrack::Video(t) => assert!(t.extra.is_empty(), "{path:?}"),
                    OverlayTrack::Text(t) => {
                        assert!(t.extra.is_empty(), "{path:?}");
                        assert!(t.elements.iter().all(|e| e.extra.is_empty()), "{path:?}");
                    }
                    OverlayTrack::Graphic(t) => assert!(t.extra.is_empty(), "{path:?}"),
                    OverlayTrack::Effect(t) => {
                        assert!(t.extra.is_empty(), "{path:?}");
                        assert!(t.elements.iter().all(|e| e.extra.is_empty()), "{path:?}");
                    }
                }
            }
            for track in &scene.tracks.audio {
                assert!(track.extra.is_empty(), "{path:?}");
                for element in &track.elements {
                    assert!(
                        element.extra().is_empty(),
                        "{path:?}: {:?}",
                        element.extra()
                    );
                    assert!(matches!(
                        element.source,
                        AudioSource::Upload { .. } | AudioSource::Library { .. }
                    ));
                }
            }
        }
    }
}

#[test]
fn element_union_discriminates_by_type() {
    use timeline::{AudioSource, TimelineElement};

    let raw = read_json(&fixture_dir("projects").join("audio-text-graphics.json"));
    let project: Project = serde_json::from_value(raw).unwrap();
    let tracks = &project.scenes[0].tracks;
    let library = serde_json::to_value(&tracks.audio[1].elements[0]).unwrap();
    match serde_json::from_value::<TimelineElement>(library).unwrap() {
        TimelineElement::Audio(audio) => {
            assert!(matches!(audio.source, AudioSource::Library { .. }));
            assert_eq!(audio.retime.unwrap().rate, 0.75);
        }
        other => panic!("expected audio element, got {other:?}"),
    }
    assert!(
        serde_json::from_value::<TimelineElement>(serde_json::json!({"type": "nope"})).is_err()
    );
}

#[test]
fn round_trip_preserves_unknown_audio_element_fields() {
    let raw = read_json(&fixture_dir("projects").join("unknown-fields.json"));
    let out =
        serde_json::to_value(serde_json::from_value::<Project>(raw.clone()).unwrap()).unwrap();
    let path =
        |v: &Value| v["scenes"][0]["tracks"]["audio"][0]["elements"][0]["futureAudioField"].clone();
    assert_eq!(path(&out), serde_json::json!([1, "two"]));
    assert_eq!(path(&out), path(&raw));
}
