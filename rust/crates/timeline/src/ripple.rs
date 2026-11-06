//! Ripple editing. A literal port of `apps/web/src/lib/ripple/{diff,apply,shift}.ts`:
//! after an edit, gaps the edit freed on a track close up by shifting later
//! elements left.

use std::collections::HashSet;

use serde_json::Value;

use crate::animation_split::js_num;
use crate::model::SceneTracks;
use crate::ops::elements::{ordered_track_ids, set_track_elements, track_elements};
use crate::placement::{ElementSpan, ordered_tracks};

#[derive(Clone, Debug, PartialEq)]
pub struct RippleAdjustment {
    pub track_id: String,
    pub after_time: f64,
    pub shift_amount: f64,
}

#[derive(Clone, Copy, Debug)]
struct Interval {
    start_time: f64,
    end_time: f64,
}

#[derive(Clone, Copy)]
struct Span {
    start_time: f64,
    end_time: f64,
}

/// A JS `Map` keyed by id: first insertion fixes the position, later ones
/// overwrite the value.
fn span_map(elements: &[ElementSpan<'_>]) -> Vec<(String, Span)> {
    let mut map: Vec<(String, Span)> = Vec::new();
    for element in elements {
        let span = Span {
            start_time: element.start_time.0,
            end_time: element.start_time.0 + element.duration.0,
        };
        match map.iter_mut().find(|(id, _)| id == element.id) {
            Some(entry) => entry.1 = span,
            None => map.push((element.id.to_string(), span)),
        }
    }
    map
}

fn push_interval(intervals: &mut Vec<Interval>, start_time: f64, end_time: f64) {
    if end_time <= start_time {
        return;
    }
    intervals.push(Interval {
        start_time,
        end_time,
    });
}

fn normalize_intervals(intervals: &[Interval]) -> Vec<Interval> {
    let mut valid = Vec::new();
    for interval in intervals {
        push_interval(&mut valid, interval.start_time, interval.end_time);
    }
    valid.sort_by(|left, right| {
        (left.start_time - right.start_time)
            .partial_cmp(&0.0)
            .unwrap_or(std::cmp::Ordering::Equal)
    });
    let mut merged: Vec<Interval> = Vec::new();
    for interval in valid {
        match merged.last_mut() {
            Some(previous) if interval.start_time <= previous.end_time => {
                previous.end_time = js_max(previous.end_time, interval.end_time);
            }
            _ => merged.push(interval),
        }
    }
    merged
}

fn js_max(a: f64, b: f64) -> f64 {
    crate::animation_split::js_max(a, b)
}

fn subtract_single(source: Interval, overlapping: &[Interval]) -> Vec<Interval> {
    let mut remaining = vec![source];
    for overlap in overlapping {
        remaining = remaining
            .into_iter()
            .flat_map(|rem| {
                if overlap.end_time <= rem.start_time || overlap.start_time >= rem.end_time {
                    return vec![rem];
                }
                let mut next = Vec::new();
                push_interval(&mut next, rem.start_time, overlap.start_time);
                push_interval(&mut next, overlap.end_time, rem.end_time);
                next
            })
            .collect();
        if remaining.is_empty() {
            return remaining;
        }
    }
    remaining
}

fn subtract_interval_sets(source: &[Interval], overlapping: &[Interval]) -> Vec<Interval> {
    let source = normalize_intervals(source);
    let overlapping = normalize_intervals(overlapping);
    source
        .into_iter()
        .flat_map(|interval| subtract_single(interval, &overlapping))
        .collect()
}

fn compute_track(
    track_id: &str,
    before: &[ElementSpan<'_>],
    after: &[ElementSpan<'_>],
    all_after_ids: &HashSet<&str>,
) -> Vec<RippleAdjustment> {
    let before = span_map(before);
    let after = span_map(after);

    let mut vacated = Vec::new();
    let mut joined = Vec::new();
    for (id, before_span) in &before {
        match after.iter().find(|(after_id, _)| after_id == id) {
            None => {
                if !all_after_ids.contains(id.as_str()) {
                    push_interval(&mut vacated, before_span.start_time, before_span.end_time);
                }
            }
            Some((_, after_span)) => {
                if before_span.end_time > after_span.end_time {
                    push_interval(&mut vacated, after_span.end_time, before_span.end_time);
                }
            }
        }
    }
    for (id, after_span) in &after {
        if before.iter().any(|(before_id, _)| before_id == id) {
            continue;
        }
        push_interval(&mut joined, after_span.start_time, after_span.end_time);
    }

    let freed = subtract_interval_sets(
        &normalize_intervals(&vacated),
        &normalize_intervals(&joined),
    );
    freed
        .into_iter()
        .filter_map(|interval| {
            let shift_amount = interval.end_time - interval.start_time;
            if shift_amount <= 0.0 {
                return None;
            }
            Some(RippleAdjustment {
                track_id: track_id.to_string(),
                after_time: interval.end_time,
                shift_amount,
            })
        })
        .collect()
}

/// `computeRippleAdjustments`.
pub fn compute(before: &SceneTracks, after: &SceneTracks) -> Vec<RippleAdjustment> {
    let before_tracks = ordered_tracks(before);
    let after_tracks = ordered_tracks(after);
    let all_after_ids: HashSet<&str> = after_tracks
        .iter()
        .flat_map(|track| track.elements.iter().map(|element| element.id))
        .collect();

    before_tracks
        .iter()
        .flat_map(|before_track| {
            // `new Map(...)`: a later track with the same id wins.
            let after_elements = after_tracks
                .iter()
                .rev()
                .find(|track| track.id == before_track.id)
                .map(|track| track.elements.as_slice())
                .unwrap_or_default();
            compute_track(
                before_track.id,
                &before_track.elements,
                after_elements,
                &all_after_ids,
            )
        })
        .collect()
}

/// `applyRippleAdjustments`: per track, latest adjustment first, shifts every
/// element starting at or after `after_time` left by `shift_amount`.
pub fn apply(tracks: &SceneTracks, adjustments: &[RippleAdjustment]) -> SceneTracks {
    let mut result = tracks.clone();
    if adjustments.is_empty() {
        return result;
    }
    for track_id in ordered_track_ids(tracks) {
        let mut track_adjustments: Vec<&RippleAdjustment> = adjustments
            .iter()
            .filter(|adjustment| adjustment.track_id == track_id)
            .collect();
        if track_adjustments.is_empty() {
            continue;
        }
        track_adjustments.sort_by(|first, second| {
            (second.after_time - first.after_time)
                .partial_cmp(&0.0)
                .unwrap_or(std::cmp::Ordering::Equal)
        });
        let Some(mut elements) = track_elements(&result, &track_id) else {
            continue;
        };
        for adjustment in track_adjustments {
            for element in elements.iter_mut() {
                let Some(map) = element.as_object_mut() else {
                    continue;
                };
                let start_time = map
                    .get("startTime")
                    .and_then(Value::as_f64)
                    .unwrap_or(f64::NAN);
                if start_time >= adjustment.after_time {
                    map.insert(
                        "startTime".into(),
                        js_num(start_time - adjustment.shift_amount),
                    );
                }
            }
        }
        // Shifted values came from valid elements, so they deserialize.
        let _ = set_track_elements(&mut result, &track_id, elements);
    }
    result
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;

    fn scene(elements: serde_json::Value) -> SceneTracks {
        serde_json::from_value(json!({
            "overlay": [],
            "main": {"id": "main", "name": "Main Track", "type": "video", "muted": false,
                     "hidden": false, "elements": elements},
            "audio": []
        }))
        .unwrap()
    }

    fn clip(id: &str, start: f64, duration: f64) -> serde_json::Value {
        json!({
            "type": "video", "id": id, "mediaId": "m", "name": id, "duration": duration,
            "startTime": start, "trimStart": 0, "trimEnd": 0, "sourceDuration": duration,
            "muted": false, "isSourceAudioEnabled": true, "hidden": false,
            "transform": {"scaleX": 1, "scaleY": 1, "position": {"x": 0, "y": 0}, "rotate": 0},
            "opacity": 1, "blendMode": "normal", "volume": 0
        })
    }

    #[test]
    fn removed_element_shifts_later_ones() {
        let before = scene(json!([clip("a", 0.0, 100.0), clip("b", 100.0, 50.0)]));
        let after = scene(json!([clip("b", 100.0, 50.0)]));
        let adjustments = compute(&before, &after);
        assert_eq!(
            adjustments,
            vec![RippleAdjustment {
                track_id: "main".into(),
                after_time: 100.0,
                shift_amount: 100.0
            }]
        );
        let shifted = serde_json::to_value(apply(&after, &adjustments)).unwrap();
        assert_eq!(shifted["main"]["elements"][0]["startTime"], 0);
    }

    #[test]
    fn unchanged_scene_has_no_adjustments() {
        let scene = scene(json!([clip("a", 0.0, 100.0)]));
        assert!(compute(&scene, &scene).is_empty());
    }
}
