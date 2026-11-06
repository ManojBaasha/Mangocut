use serde::{Deserialize, Serialize};

/// Error returned by `apply_op`. `code` is stable and machine readable;
/// `hint` tells the caller (often the AI agent) how to recover.
#[cfg_attr(feature = "wasm", derive(tsify_next::Tsify))]
#[cfg_attr(feature = "wasm", tsify(into_wasm_abi, from_wasm_abi))]
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct TimelineError {
    pub code: String,
    pub message: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub hint: Option<String>,
}

impl TimelineError {
    pub fn new(code: &str, message: impl Into<String>) -> Self {
        Self {
            code: code.to_string(),
            message: message.into(),
            hint: None,
        }
    }

    pub fn with_hint(mut self, hint: impl Into<String>) -> Self {
        self.hint = Some(hint.into());
        self
    }

    pub fn element_not_found(element_id: &str) -> Self {
        Self::new(
            "element_not_found",
            format!("element {element_id} not found"),
        )
        .with_hint("list the timeline to find valid element ids")
    }

    pub fn track_not_found(track_id: &str) -> Self {
        Self::new("track_not_found", format!("track {track_id} not found"))
            .with_hint("list the timeline to find valid track ids")
    }

    pub fn missing_ids() -> Self {
        Self::new(
            "missing_ids",
            "the operation needs more new ids than were supplied",
        )
        .with_hint(
            "pass one fresh unique id per created element (plus one per created track) in newIds",
        )
    }

    pub fn duplicate_id(id: &str) -> Self {
        Self::new(
            "duplicate_id",
            format!("new id {id} is already used by the timeline or repeated in newIds"),
        )
        .with_hint("generate fresh unique ids that match no existing element or track id")
    }

    pub fn invalid_trim(message: impl Into<String>, hint: impl Into<String>) -> Self {
        Self::new("invalid_trim", message).with_hint(hint)
    }

    pub fn incompatible_track(message: impl Into<String>, hint: impl Into<String>) -> Self {
        Self::new("incompatible_track", message).with_hint(hint)
    }

    pub fn invalid_result(message: impl Into<String>, hint: impl Into<String>) -> Self {
        Self::new("invalid_result", message).with_hint(hint)
    }

    pub fn unsupported_op(op: &str) -> Self {
        Self::new(
            "unsupported_op",
            format!("operation {op} is not implemented yet"),
        )
        .with_hint("use one of the supported operation types")
    }

    /// Prefixes the message (used by `Batch` to name the failing op).
    pub fn prefixed(mut self, prefix: &str) -> Self {
        self.message = format!("{prefix}{}", self.message);
        self
    }
}

impl std::fmt::Display for TimelineError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}: {}", self.code, self.message)
    }
}

impl std::error::Error for TimelineError {}
