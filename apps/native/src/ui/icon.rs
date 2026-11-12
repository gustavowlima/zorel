// Zorel's icons (prototype `.ic`): one stroke (1.6, set when the SVG loads: assets.rs), three sizes. Every icon in
// the app goes through here so sizes never drift.
use gpui_kit::{assets::IconName, component::Icon, *};

/// In rows, buttons and fields.
pub const MD: f32 = 16.;
/// Beside small text (12.5px).
pub const SM: f32 = 15.;
/// Chevrons and chips.
pub const XS: f32 = 13.;

pub fn icon(name: IconName, size: f32) -> Icon {
    Icon::new(name).size(px(size))
}
