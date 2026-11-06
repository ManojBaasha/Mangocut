//! Retime math. Mirrors `apps/web/src/lib/retime/{rate,resolve,split}.ts`
//! float-for-float: nothing is rounded to a whole tick.

use crate::model::{RetimeConfig, Ticks};

pub const DEFAULT_RETIME_RATE: f64 = 1.0;
pub const MIN_RETIME_RATE: f64 = 0.01;
pub const MAX_RETIME_RATE: f64 = 5.0;

pub fn clamp_retime_rate(rate: f64) -> f64 {
    if !rate.is_finite() || rate <= 0.0 {
        return DEFAULT_RETIME_RATE;
    }
    rate.max(MIN_RETIME_RATE).min(MAX_RETIME_RATE)
}

fn safe_rate(retime: Option<&RetimeConfig>) -> f64 {
    clamp_retime_rate(retime.map_or(1.0, |retime| retime.rate))
}

pub fn source_time_at_clip_time(clip_time: Ticks, retime: Option<&RetimeConfig>) -> Ticks {
    Ticks(clip_time.0 * safe_rate(retime))
}

pub fn clip_time_at_source_time(source_time: Ticks, retime: Option<&RetimeConfig>) -> Ticks {
    Ticks(source_time.0 / safe_rate(retime))
}

pub fn source_span_at_clip_time(clip_time: Ticks, retime: Option<&RetimeConfig>) -> Ticks {
    Ticks(source_time_at_clip_time(clip_time, retime).0.max(0.0))
}

pub fn timeline_duration_for_source_span(
    source_span: Ticks,
    retime: Option<&RetimeConfig>,
) -> Ticks {
    if source_span.0 <= 0.0 {
        return Ticks(0.0);
    }
    Ticks(source_span.0 / safe_rate(retime))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::Map;

    fn retime(rate: f64) -> RetimeConfig {
        RetimeConfig {
            rate,
            maintain_pitch: None,
            extra: Map::new(),
        }
    }

    #[test]
    fn clamps_rates() {
        assert_eq!(clamp_retime_rate(0.0), 1.0);
        assert_eq!(clamp_retime_rate(-2.0), 1.0);
        assert_eq!(clamp_retime_rate(f64::NAN), 1.0);
        assert_eq!(clamp_retime_rate(9.0), 5.0);
        assert_eq!(clamp_retime_rate(0.001), 0.01);
        assert_eq!(clamp_retime_rate(2.0), 2.0);
    }

    #[test]
    fn maps_clip_time_to_source_time() {
        let config = retime(2.0);
        assert_eq!(
            source_time_at_clip_time(Ticks(120_000.0), Some(&config)),
            Ticks(240_000.0)
        );
        assert_eq!(
            source_time_at_clip_time(Ticks(120_000.0), None),
            Ticks(120_000.0)
        );
        assert_eq!(
            clip_time_at_source_time(Ticks(240_000.0), Some(&config)),
            Ticks(120_000.0)
        );
    }

    #[test]
    fn keeps_fractional_ticks() {
        let config = retime(0.3);
        let out = source_time_at_clip_time(Ticks(7.0), Some(&config));
        assert_eq!(out.0, 7.0 * 0.3);
        assert_ne!(out.0.fract(), 0.0);
    }

    #[test]
    fn source_span_and_duration() {
        let config = retime(2.0);
        assert_eq!(
            source_span_at_clip_time(Ticks(-5.0), Some(&config)),
            Ticks(0.0)
        );
        assert_eq!(
            timeline_duration_for_source_span(Ticks(240_000.0), Some(&config)),
            Ticks(120_000.0)
        );
        assert_eq!(
            timeline_duration_for_source_span(Ticks(0.0), Some(&config)),
            Ticks(0.0)
        );
    }
}
