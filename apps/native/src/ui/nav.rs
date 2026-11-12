// A navigation row: the sidebar's places, sections' projects and chats (and the screens to come). A leading mark (an
// icon or any element), a label that truncates with an optional detail line under it, a trailing element that a
// hover-only element (+, ⋯) replaces while hovered; open = the control wash. Rail mode shows only the mark, square.
// Hover eases in and out (ui/motion), so every list of places moves the same way.
use std::rc::Rc;

use gpui_kit::{assets::IconName, prelude::FluentBuilder, *};

use crate::ui::icon::{self, icon};
use crate::ui::space;
use crate::{
    theme::{self, tokens},
    ui::motion,
};

type OnClick = Box<dyn Fn(&ClickEvent, &mut Window, &mut App) + 'static>;
/// What a dragged row carries: its group (only rows of the same group take the drop) and its id.
#[derive(Clone)]
pub struct DragRow {
    pub group: SharedString,
    pub id: SharedString,
    pub label: SharedString,
}

/// Called on the row a dragged one is dropped on: (dragged, target).
pub type OnReorder = Rc<dyn Fn(&DragRow, &DragRow, &mut Window, &mut App) + 'static>;

/// A row's actions, built on demand: the right-click menu and its ⋯ button share one builder.
pub type MenuBuilder = crate::ui::menu::Items;

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
    reorder: Option<(DragRow, OnReorder)>,
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
            reorder: None,
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

    /// Drag to reorder within the row's group: dropping on a row of the same group moves this one before it.
    pub fn reorder(mut self, row: DragRow, on_reorder: OnReorder) -> Self {
        self.reorder = Some((row, on_reorder));
        self
    }

    /// The row's actions on right-click (ui/menu).
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
                .map(|i| icon(i, icon::MD).text_color(mark_color).into_any_element())
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
        let key = self.id.clone();
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
                    r.gap(px(space::X2_5))
                        .h(px(if tall { 52. } else { 32. }))
                        .pl(px(space::X2_5 + self.indent))
                        .pr(px(space::X2))
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
                    r.child(div().flex_none().flex().items_center().gap(px(space::X0_5)).child(t))
                })
            })
            .when(!self.disabled, |r| {
                r.when_some(self.on_click, |r, handler| r.on_click(handler))
            });
        let row = match self.reorder {
            Some((this_row, on_reorder)) => {
                let (over, drop_on) = (this_row.clone(), this_row.clone());
                let accent = p.accent;
                row.on_drag(this_row, |dragged, _, _, cx| {
                    cx.new(|_| DragPreview(dragged.label.clone()))
                })
                .drag_over::<DragRow>(move |style, dragged, _, _| {
                    if dragged.group == over.group && dragged.id != over.id {
                        style.border_t_2().border_color(accent)
                    } else {
                        style
                    }
                })
                .on_drop(move |dragged: &DragRow, window, cx| {
                    if dragged.group == drop_on.group && dragged.id != drop_on.id {
                        on_reorder(dragged, &drop_on, window, cx);
                    }
                })
            }
            None => row,
        };
        let row = motion::track(row, &pointer);
        match self.menu {
            Some(items) => crate::ui::menu::on_right_click(&key, row, items, window, cx),
            None => row.into_any_element(),
        }
    }
}

/// What follows the pointer while a row is dragged: its label on a raised chip.
struct DragPreview(SharedString);

impl Render for DragPreview {
    fn render(&mut self, window: &mut Window, _: &mut Context<Self>) -> impl IntoElement {
        let p = theme::palette(window);
        div()
            .px(px(space::X2_5))
            .py(px(space::X1_5))
            .rounded(px(tokens::RADIUS_ROW))
            .bg(p.bg_raised)
            .border_1()
            .border_color(p.border_strong)
            .text_color(p.text)
            .opacity(0.9)
            .child(self.0.clone())
    }
}

/// Moves `dragged` before `target` in a group's ids (the order sent to the engine).
pub fn moved_before(ids: &[String], dragged: &str, target: &str) -> Vec<String> {
    let mut out: Vec<String> = ids.iter().filter(|id| *id != dragged).cloned().collect();
    let at = out.iter().position(|id| id == target).unwrap_or(out.len());
    out.insert(at, dragged.to_string());
    out
}

#[cfg(test)]
mod tests {
    use super::moved_before;

    #[test]
    fn a_dropped_row_goes_before_its_target() {
        let ids: Vec<String> = ["a", "b", "c", "d"].iter().map(|s| s.to_string()).collect();
        assert_eq!(moved_before(&ids, "d", "b"), ["a", "d", "b", "c"]);
        assert_eq!(moved_before(&ids, "a", "c"), ["b", "a", "c", "d"]);
    }
}
