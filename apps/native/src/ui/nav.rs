// A navigation row (the sidebar's chats, "Pending" and the screens to come): a leading mark, a label that truncates,
// an optional trailing count; open = the control wash. Hover eases in and out (ui/motion), so every list of places
// moves the same way.
use gpui_kit::{prelude::FluentBuilder, *};

use crate::{
    theme::{self, tokens},
    ui::motion,
};

type OnClick = Box<dyn Fn(&ClickEvent, &mut Window, &mut App) + 'static>;

#[derive(IntoElement)]
pub struct NavRow {
    id: ElementId,
    label: SharedString,
    leading: Option<AnyElement>,
    trailing: Option<AnyElement>,
    active: bool,
    on_click: Option<OnClick>,
}

impl NavRow {
    pub fn new(id: impl Into<ElementId>, label: impl Into<SharedString>) -> Self {
        Self {
            id: id.into(),
            label: label.into(),
            leading: None,
            trailing: None,
            active: false,
            on_click: None,
        }
    }

    pub fn leading(mut self, element: impl IntoElement) -> Self {
        self.leading = Some(element.into_any_element());
        self
    }

    pub fn trailing(mut self, element: impl IntoElement) -> Self {
        self.trailing = Some(element.into_any_element());
        self
    }

    pub fn active(mut self, active: bool) -> Self {
        self.active = active;
        self
    }

    pub fn on_click(mut self, handler: impl Fn(&ClickEvent, &mut Window, &mut App) + 'static) -> Self {
        self.on_click = Some(Box::new(handler));
        self
    }
}

impl RenderOnce for NavRow {
    fn render(self, window: &mut Window, cx: &mut App) -> impl IntoElement {
        let p = theme::palette(window);
        let pointer = motion::pointer(&self.id, window, cx);
        let hovered = pointer.read(cx).hovered;
        let wash = match (self.active, hovered) {
            (true, _) => p.bg_control_active,
            (false, true) => p.bg_hover,
            (false, false) => Rgba { a: 0., ..p.bg_hover },
        };
        let bg = motion::color(&self.id, "wash", wash, window, cx);
        let fg = motion::color(
            &self.id,
            "text",
            if self.active || hovered {
                p.text
            } else {
                p.text_secondary
            },
            window,
            cx,
        );
        let row = div()
            .id(self.id)
            .flex()
            .items_center()
            .gap(px(8.))
            .h(px(32.))
            .px(px(8.))
            .rounded(px(tokens::RADIUS_ROW))
            .bg(bg)
            .text_color(fg)
            .when_some(self.leading, |r, l| r.child(l))
            .child(div().flex_1().min_w_0().truncate().child(self.label))
            .when_some(self.trailing, |r, t| r.child(t))
            .when_some(self.on_click, |r, handler| r.on_click(handler));
        motion::track(row, &pointer)
    }
}
