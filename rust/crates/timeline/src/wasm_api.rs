//! The wasm entry points. Options are deserialized here, not by
//! wasm-bindgen, so malformed input (wrong types, a negative index into a
//! `usize`, an unknown op type) surfaces as a typed `invalid_op`
//! `TimelineError` with the failing path instead of a bare string.

use serde::de::DeserializeOwned;
use wasm_bindgen::prelude::*;

use crate::error::TimelineError;
use crate::ops::{OpOutput, apply_op};
use crate::validate::validate_tracks;

fn parse<T: DeserializeOwned>(value: JsValue) -> Result<T, TimelineError> {
    let deserializer = serde_wasm_bindgen::Deserializer::from(value);
    serde_path_to_error::deserialize(deserializer).map_err(|error| {
        let path = error.path().to_string();
        let inner = error.into_inner().to_string();
        // serde-wasm-bindgen errors are JS `Error`s; drop their name prefix.
        let inner = inner.strip_prefix("Error: ").unwrap_or(&inner);
        if path == "." {
            TimelineError::invalid_op(format!("invalid options: {inner}"))
        } else {
            TimelineError::invalid_op(format!("invalid options at {path}: {inner}"))
        }
    })
}

#[wasm_bindgen(js_name = applyOp)]
pub fn apply_op_js(
    #[wasm_bindgen(unchecked_param_type = "ApplyOpOptions")] options: JsValue,
) -> Result<OpOutput, TimelineError> {
    apply_op(parse(options)?)
}

#[wasm_bindgen(js_name = validateTracks)]
pub fn validate_tracks_js(
    #[wasm_bindgen(unchecked_param_type = "ValidateOptions")] options: JsValue,
) -> Result<Vec<TimelineError>, TimelineError> {
    Ok(validate_tracks(parse(options)?))
}
