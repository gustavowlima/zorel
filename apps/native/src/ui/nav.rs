// A navigation row: the sidebar's places, sections' projects and chats (and the screens to come). A leading mark (an
// icon or any element), a label that truncates with an optional detail line under it, a trailing element that a
// hover-only element (+, ⋯) replaces while hovered; open = the control wash. Rail mode shows only the mark, square.
// Hover eases in and out (ui/motion), so every list of places moves the same way.
use std::rc::Rc;

use gpui_kit::{
    assets::IconName,
    component::{Icon, Sizable as _, menu::PopupMenu},
    prelude::FluentBuilder,
    *,
};

use crate::{
    theme::{self, tokens},
    ui::motion,
};

type OnClick = Box<dyn Fn(&ClickEvent, &mut Window, &mut App) + 'static>;
/// A row's actions, built on demand: the right-click menu and its ⋯ button share one builder.
pub type MenuBuilder = Rc<dyn Fn(PopupMenu, &mut Window, &mut Context<PopupMenu>) -> PopupMenu + 'static>;

#[derive(IntoElement)]
pub struct NavRow {
    id: ElementId,
    label: SharedString,
    leading: Option<AnyElement>,
    icon: Option<IconName>,
    detail: Option<(SharedString, Option<Rgba>)>,
    trailing: Option<AnyElement>,
    on_hover: Option<AnyElement>,
    indent: f32,
    rail: bool,
    active: bool,
    emphasis: bool,
    disabled: bool,
    on_click: Option<OnClick>,
    menu: Option<MenuBuilder>,
    expanded: Option<bool>,
}

impl NavRow {
    pub fn new(id: impl Into<ElementId>, label: impl Into<SharedString>) -> Self {
        Self {
            id: id.into(),
            label: label.into(),
            leading: None,
            icon: None,
            detail: None,
            trailing: None,
            on_hover: None,
            indent: 0.,
            rail: false,
            active: false,
            emphasis: false,
            disabled: false,
            on_click: None,
            menu: None,
            expanded: None,
        }
    }

    pub fn icon(mut self, icon: IconName) -> Self {
        self.icon = Some(icon);
        self
    }

    pub fn leading(mut self, element: impl IntoElement) -> Self {
        self.leading = Some(element.into_any_element());
        self
    }

    /// A second line under the label (a chat's live status), in a tone when given.
    pub fn detail(mut self, text: impl Into<SharedString>, tone: Option<Rgba>) -> Self {
        self.detail = Some((text.into(), tone));
        self
    }

    pub fn trailing(mut self, element: impl IntoElement) -> Self {
        self.trailing = Some(element.into_any_element());
        self
    }

    /// Shown instead of `trailing` while the row is hovered (+, ⋯).
    pub fn on_hover_trailing(mut self, element: impl IntoElement) -> Self {
        self.on_hover = Some(element.into_any_element());
        self
    }

    pub fn indent(mut self, px: f32) -> Self {
        self.indent = px;
        self
    }

    /// The folded sidebar: only the mark, in a 40px square.
    pub fn rail(mut self, rail: bool) -> Self {
        self.rail = rail;
        self
    }

    pub fn active(mut self, active: bool) -> Self {
        self.active = active;
        self
    }

    /// Medium weight without being open (a chat that waits for you).
    pub fn emphasis(mut self, emphasis: bool) -> Self {
        self.emphasis = emphasis;
        self
    }

    pub fn disabled(mut self, disabled: bool) -> Self {
        self.disabled = disabled;
        self
    }

    /// A row that opens and closes what's under it (a project): screen readers hear its state.
    pub fn expanded(mut self, expanded: bool) -> Self {
        self.expanded = Some(expanded);
        self
    }

    /// The row's actions on right-click (Menu key and Shift+F10 included).
    pub fn menu(mut self, menu: MenuBuilder) -> Self {
        self.menu = Some(menu);
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
        let hovered = pointer.read(cx).hovered && !self.disabled;
        let wash = match (self.active, hovered) {
            (true, _) => p.bg_control_hover,
            (false, true) => p.bg_hover,
            (false, false) => Rgba { a: 0., ..p.bg_hover },
        };
        let bg = motion::color(&self.id, "wash", wash, window, cx);
        let lit = self.active || hovered;
        let fg = motion::color(
            &self.id,
            "text",
            if lit { p.text } else { p.text_secondary },
            window,
            cx,
        );
        let mark_color = if lit { p.text } else { p.text_muted };
        let mark: Option<AnyElement> = self.leading.or_else(|| {
            self.icon
                .map(|i| Icon::new(i).small().text_color(mark_color).into_any_element())
        });
        let tall = self.detail.is_some();
        let trailing = if hovered {
            self.on_hover.or(self.trailing)
        } else {
            self.trailing
        };
        // Screen readers: a button named by its label, the detail as its description, selected when open.
        let label = self.label.clone();
        let description = self.detail.as_ref().map(|(d, _)| d.clone());
        let row = div()
            .id(self.id)
            .role(Role::Button)
            .aria_label(label)
            .when_some(description, |r, d| r.aria_description(d))
            .aria_selected(self.active)
            .when_some(self.expanded, |r, e| r.aria_expanded(e))
            .flex()
            .flex_none()
            .items_center()
            .rounded(px(tokens::RADIUS_ROW))
            .bg(bg)
            .text_color(fg)
            .when(self.disabled, |r| r.opacity(0.45))
            .when(self.active || self.emphasis, |r| r.font_weight(FontWeight::MEDIUM))
            .map(|r| {
                if self.rail {
                    r.size(px(40.)).justify_center()
                } else {
                    r.gap(px(10.))
                        .h(px(if tall { 52. } else { 32. }))
                        .pl(px(10. + self.indent))
                        .pr(px(8.))
                }
            })
            .when_some(mark, |r, m| r.child(m))
            .when(!self.rail, |r| {
                r.child(
                    div()
                        .flex()
                        .flex_col()
                        .flex_1()
                        .min_w_0()
                        .child(div().truncate().child(self.label))
                        .when_some(self.detail, |c, (text, tone)| {
                            c.child(
                                div()
                                    .text_xs()
                                    .truncate()
                                    .text_color(tone.unwrap_or(p.text_muted))
                                    .child(text),
                            )
                        }),
                )
                .when_some(trailing, |r, t| {
                    r.child(div().flex_none().flex().items_center().gap(px(2.)).child(t))
                })
            })
            .when(!self.disabled, |r| {
                r.when_some(self.on_click, |r, handler| r.on_click(handler))
            });
        motion::track(row, &pointer)
    }
}
