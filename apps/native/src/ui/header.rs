// A screen's top bar (prototype Chat: `header`, 52px): the title at 14px semibold, a small context line beside it
// (project, branch), then whatever the screen puts on the right (faces, actions, and soon the tabs of what the
// chat has open: terminal, files, browser). A hairline under it; the bar also drags the window, as a title bar does.
use gpui_kit::{prelude::FluentBuilder, *};

use crate::{theme, ui::space};

/// The bar's height (prototype: 52px).
pub const HEIGHT: f32 = 52.;

#[derive(IntoElement)]
pub struct Header {
    title: SharedString,
    context: Option<SharedString>,
    trailing: Vec<AnyElement>,
}

impl Header {
    pub fn new(title: impl Into<SharedString>) -> Self {
        Self {
            title: title.into(),
            context: None,
            trailing: Vec::new(),
        }
    }

    /// The small line beside the title (project · branch).
    pub fn context(mut self, context: impl Into<SharedString>) -> Self {
        self.context = Some(context.into());
        self
    }

    /// Something on the right, in order.
    pub fn trailing(mut self, element: impl IntoElement) -> Self {
        self.trailing.push(element.into_any_element());
        self
    }
}

impl RenderOnce for Header {
    fn render(self, window: &mut Window, _: &mut App) -> impl IntoElement {
        let p = theme::palette(window);
        div()
            .window_control_area(WindowControlArea::Drag)
            .flex()
            .flex_none()
            .items_center()
            .gap(px(space::X2_5))
            .h(px(HEIGHT))
            .pl(px(space::X5))
            .pr(px(space::X3))
            .border_b_1()
            .border_color(p.border)
            .child(
                div()
                    .flex_none()
                    .max_w(px(420.))
                    .truncate()
                    .text_size(px(14.))
                    .font_weight(FontWeight::SEMIBOLD)
                    .text_color(p.text)
                    .child(self.title),
            )
            .when_some(self.context, |h, c| {
                h.child(
                    div()
                        .min_w_0()
                        .truncate()
                        .text_size(px(12.5))
                        .text_color(p.text_muted)
                        .child(c),
                )
            })
            .child(div().flex_1())
            .children(self.trailing)
    }
}
