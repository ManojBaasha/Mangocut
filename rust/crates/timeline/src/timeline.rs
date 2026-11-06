//! Timeline model and operations.

mod animation_split;
mod error;
mod model;
mod ops;
mod placement;
mod retime;
mod ripple;
mod validate;

// Public API: the model, the op/option/result/error types, and the two entry
// points. Placement, retime and ripple helpers stay crate-private.
pub use error::TimelineError;
pub use model::*;
pub use ops::{
    ApplyOpOptions, CreateTrack, ElementUpdate, InsertPlacement, OpOutput, RetainSide, TimelineOp,
    apply_op,
};
pub use placement::TrackType;
pub use validate::{ValidateOptions, validate_tracks};
