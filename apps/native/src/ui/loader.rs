// Zorel's loader: the mark (its two orbits around the core) turning, easing in and out of each turn, its colour
// breathing a little. Used wherever something is on its way (a live turn's status, a step running, a screen starting)
// instead of a generic spinner.
use gpui_kit::*;

use crate::{assets::LOGO, ui::motion};

/// One full turn.
const TURN_MS: u64 = 1400;

#[derive(IntoElement)]
pub struct Loader {
    id: ElementId,
    size: f32,
    color: Option<Rgba>,
}

impl Loader {
    pub fn new(id: impl Into<ElementId>) -> Self {
        Self {
            id: id.into(),
            size: 16.,
            color: None,
        }
    }

    pub fn size(mut self, size: f32) -> Self {
        self.size = size;
        self
    }

    pub fn color(mut self, color: Rgba) -> Self {
        self.color = Some(color);
        self
    }
}

impl RenderOnce for Loader {
    fn render(self, window: &mut Window, _: &mut App) -> impl IntoElement {
        let color = self.color.unwrap_or(crate::theme::palette(window).text_secondary);
        svg()
            .path(LOGO)
            .size(px(self.size))
            .flex_none()
            .text_color(color)
            .with_animation(
                self.id,
                Animation::new(motion::ms(TURN_MS)).repeat().with_easing(ease_in_out),
                move |svg, t| {
                    svg.with_transformation(Transformation::rotate(radians(t * std::f32::consts::TAU)))
                        .opacity(0.7 + 0.3 * (t * std::f32::consts::PI).sin())
                },
            )
    }
}
