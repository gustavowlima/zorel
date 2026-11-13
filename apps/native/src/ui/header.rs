// The screen's title strip: part of the window's frame, above the canvas card and set back from it (not a bar inside
// the card), ending where the sidebar's logo and name begin (the card's top edge lines up with them). The title at 14px semibold, a small context beside it (project, branch),
// then whatever the screen puts on the right (faces, and soon the tabs of what the chat has open: terminal, files,
// browser). It drags the window, as a title bar does.
use gpui_kit::{prelude::FluentBuilder, *};

use crate::{theme, ui::space};

/// The strip's height: the traffic lights' row.
/// The strip ends where the sidebar's logo and name begin, so the card's top edge lines up with them.
pub const HEIGHT: f32 = TOP + (ROW - LOGO) / 2.;
/// The sidebar's logo mark (and the name's line beside it).
pub const LOGO: f32 = 20.;
/// Room for the macOS traffic lights above the head row (the sidebar's too).
pub const TOP: f32 = 36.;
/// The head row: the sidebar's logo and name, and level with them the screen's title.
pub const ROW: f32 = 36.;

#[derive(IntoElement)]
pub struct Header {
    /// Extra room on the left (the folded sidebar leaves the traffic lights over the strip).
    inset: f32,
    title: SharedString,
    context: Option<SharedString>,
    /// Instead of the context line: a control (the chat's project, a ghost button).
    context_element: Option<AnyElement>,
    /// The page's tabs: always here, after the title, never inside the page.
    tabs: Option<AnyElement>,
    trailing: Vec<AnyElement>,
}

impl Header {
    pub fn new(title: impl Into<SharedString>) -> Self {
        Self {
            inset: 0.,
            title: title.into(),
            context: None,
            context_element: None,
            tabs: None,
            trailing: Vec::new(),
        }
    }

    pub fn inset(mut self, px: f32) -> Self {
        self.inset = px;
        self
    }

    /// The small line beside the title (project · branch).
    pub fn context(mut self, context: impl Into<SharedString>) -> Self {
        self.context = Some(context.into());
        self
    }

    /// A control right after the title (the chat's project), in place of the context line.
    pub fn context_element(mut self, element: impl IntoElement) -> Self {
        self.context_element = Some(element.into_any_element());
        self
    }

    /// Something on the right, in order.
    /// The page's tabs, after the title (and its context).
    pub fn tabs(mut self, tabs: impl IntoElement) -> Self {
        self.tabs = Some(tabs.into_any_element());
        self
    }

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
            .px(px(space::X3)) // set back from the card's edge
            .pl(px(space::X3 + self.inset))
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
            .when_some(self.context_element, |h, e| {
                h.child(div().flex_none().ml(px(-space::X1_5)).child(e))
            })
            .when_some(self.tabs, |h, t| h.child(div().flex_none().ml(px(space::X2)).child(t)))
            .child(div().flex_1())
            .children(self.trailing)
    }
}
