//! Timeline model and operations.

mod animation_split;
mod error;
mod model;
mod ops;
mod placement;
mod retime;
pub mod ripple;

pub use error::*;
pub use model::*;
pub use ops::*;
pub use placement::*;
pub use retime::*;
