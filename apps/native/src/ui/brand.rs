// A brand's tile (providers, connectors): a rounded square in the brand's colour with its logo in white, the same
// everywhere a provider or a connector shows, so a list of them reads as one family. A brand without a logo here shows
// its initial.
use gpui_kit::{prelude::FluentBuilder, *};

/// The tile, `size` px square; `logo` an asset path (single colour, painted white) or None for the initial of `name`.
pub fn tile(logo: Option<&'static str>, name: &str, tint: u32, size: f32) -> AnyElement {
    let white = rgb(0xFFFFFF);
    div()
        .flex()
        .flex_none()
        .items_center()
        .justify_center()
        .size(px(size))
        .rounded(px((size * 0.28).round()))
        .bg(rgb(tint))
        .text_color(white)
        .map(|d| match logo {
            Some(path) => d.child(svg().path(path).size(px((size * 0.6).round())).text_color(white)),
            None => d
                .text_size(px((size * 0.5).round()))
                .font_weight(FontWeight::SEMIBOLD)
                .child(name.chars().next().unwrap_or('?').to_uppercase().to_string()),
        })
        .into_any_element()
}
