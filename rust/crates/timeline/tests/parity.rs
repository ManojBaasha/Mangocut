//! Replays the goldens written by the TS parity harness
//! (`apps/web/scripts/timeline-parity`) through `apply_op`.

use std::path::PathBuf;

use serde_json::Value;
use timeline::{ApplyOpOptions, SceneTracks, TimelineOp, apply_op};

fn goldens_dir() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/goldens")
}

fn assert_golden(name_prefix: &str) {
    let mut paths: Vec<PathBuf> = std::fs::read_dir(goldens_dir())
        .unwrap()
        .map(|entry| entry.unwrap().path())
        .filter(|path| {
            path.extension().is_some_and(|ext| ext == "json")
                && path
                    .file_name()
                    .and_then(|name| name.to_str())
                    .is_some_and(|name| name.starts_with(name_prefix))
        })
        .collect();
    paths.sort();
    assert!(!paths.is_empty(), "no goldens match prefix {name_prefix:?}");

    for path in paths {
        let golden: Value = serde_json::from_str(&std::fs::read_to_string(&path).unwrap()).unwrap();
        let tracks: SceneTracks = serde_json::from_value(golden["input"].clone())
            .unwrap_or_else(|error| panic!("{path:?}: bad input: {error}"));
        let op: TimelineOp = serde_json::from_value(golden["op"].clone())
            .unwrap_or_else(|error| panic!("{path:?}: bad op: {error}"));
        let new_ids: Vec<String> = serde_json::from_value(golden["newIds"].clone()).unwrap();
        let ripple = golden["ripple"].as_bool().unwrap_or(false);

        let output = apply_op(ApplyOpOptions {
            tracks,
            op,
            new_ids,
            ripple,
        })
        .unwrap_or_else(|error| panic!("{path:?}: apply_op failed: {error:?}"));

        let expected = &golden["expected"];
        if expected.is_null() {
            assert!(!output.changed, "{path:?}: expected no change");
        } else {
            assert_eq!(
                &serde_json::to_value(&output.tracks).unwrap(),
                expected,
                "{path:?}"
            );
        }
    }
}

#[test]
fn track_ops_match_ts() {
    assert_golden("add_track");
    assert_golden("remove_track");
    assert_golden("toggle_mute");
    assert_golden("toggle_visibility");
}

#[test]
fn insert_matches_ts() {
    assert_golden("insert_");
}

#[test]
fn split_matches_ts() {
    assert_golden("split_");
}

#[test]
fn trim_matches_ts() {
    assert_golden("trim_");
}

#[test]
fn retime_matches_ts() {
    assert_golden("retime_");
}

#[test]
fn move_matches_ts() {
    assert_golden("move_");
}

#[test]
fn delete_matches_ts() {
    assert_golden("delete_");
}

#[test]
fn duplicate_matches_ts() {
    assert_golden("duplicate_");
}

#[test]
fn update_matches_ts() {
    assert_golden("update_");
}
