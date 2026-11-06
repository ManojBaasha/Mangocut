use super::{ElementSpan, PlacementTimeSpan, TrackView};

fn would_element_overlap(
    elements: &[ElementSpan<'_>],
    start_time: f64,
    end_time: f64,
    exclude_element_id: Option<&str>,
) -> bool {
    elements.iter().any(|element| {
        if exclude_element_id.is_some_and(|id| id == element.id) {
            return false;
        }
        let element_end = element.start_time.0 + element.duration.0;
        start_time < element_end && end_time > element.start_time.0
    })
}

pub fn can_place_time_spans_on_track(
    track: &TrackView<'_>,
    time_spans: &[PlacementTimeSpan],
) -> bool {
    time_spans.iter().all(|span| {
        !would_element_overlap(
            &track.elements,
            span.start_time.0,
            span.start_time.0 + span.duration.0,
            span.exclude_element_id.as_deref(),
        )
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{Ticks, placement::TrackType};

    fn view(spans: &[(&'static str, f64, f64)]) -> TrackView<'static> {
        TrackView {
            id: "t",
            track_type: TrackType::Video,
            elements: spans
                .iter()
                .map(|&(id, start, duration)| ElementSpan {
                    id,
                    start_time: Ticks(start),
                    duration: Ticks(duration),
                })
                .collect(),
        }
    }

    fn span(start: f64, duration: f64, exclude: Option<&str>) -> PlacementTimeSpan {
        PlacementTimeSpan {
            start_time: Ticks(start),
            duration: Ticks(duration),
            exclude_element_id: exclude.map(str::to_string),
        }
    }

    #[test]
    fn touching_spans_do_not_overlap() {
        let track = view(&[("a", 0.0, 100.0)]);
        assert!(can_place_time_spans_on_track(
            &track,
            &[span(100.0, 50.0, None)]
        ));
        assert!(!can_place_time_spans_on_track(
            &track,
            &[span(99.0, 50.0, None)]
        ));
    }

    #[test]
    fn excluded_element_is_ignored() {
        let track = view(&[("a", 0.0, 100.0)]);
        assert!(can_place_time_spans_on_track(
            &track,
            &[span(10.0, 50.0, Some("a"))]
        ));
    }
}
