// A navigation row: the sidebar's places, sections' projects and chats (and the screens to come). A leading mark (an
// icon or any element), a label that truncates with an optional detail line under it, a trailing element that a
// hover-only element (+, ⋯) replaces while hovered; open = the control wash. Rail mode shows only the mark, square.
// Hover eases in and out (ui/motion), so every list of places moves the same way.

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
    /// What its ghost shows (ui/reorder::Ghost) and how wide it is.
    pub mark: crate::ui::reorder::DragMark,
    pub width: f32,
}

/// How a row takes part in a live reorder (ui/reorder): its payload, what to do while dragging over it, on a drop.
pub type Reorder = (DragRow, crate::ui::reorder::OnOver, crate::ui::reorder::OnDrop);

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
    reorder: Option<Reorder>,
    /// Being dragged: lifted in place while the list reorders around it.
    lifted: bool,
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
            lifted: false,
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

    /// Drag to reorder within the row's group, live (ui/reorder); a grip shows on hover at the row's start.
    pub fn reorder(mut self, reorder: Reorder) -> Self {
        self.reorder = Some(reorder);
        self
    }

    /// The row being dragged: its place stays open while its ghost follows the pointer.
    pub fn lifted(mut self, lifted: bool) -> Self {
        self.lifted = lifted;
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
        // One tone at three strengths (prototype: hover wash 4.5%, open wash-2 7%), so moving between them never flashes.
        let wash = match (self.active, hovered) {
            (true, _) => p.bg_control,
            (false, true) => motion::fade(p.bg_control, 0.65),
            (false, false) => motion::fade(p.bg_control, 0.),
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
        // The hover-only controls (+, ⋯) stay mounted and fade in and out over the trailing detail: a menu opened
        // from them stays open when the pointer leaves the row.
        let shown = gpui_kit::base::transition(
            ElementId::from(SharedString::from(format!("{}-reveal", self.id))),
            if hovered { 1. } else { 0. },
            gpui_kit::base::Transition::new(motion::ms(motion::HOVER_MS)),
            window,
            cx,
        );
        let (rest, on_hover) = (self.trailing, self.on_hover);
        let has_rest = rest.is_some();
        // The detail only gives way when something takes its place on hover.
        let rest_shown = if on_hover.is_some() { 1. - shown } else { 1. };
        let trailing = (rest.is_some() || on_hover.is_some()).then(|| {
            div()
                .relative()
                .flex()
                .items_center()
                .when_some(rest, |s, t| s.child(div().opacity(rest_shown).child(t)))
                .when_some(on_hover, |s, h| {
                    let h = div().flex().items_center().opacity(shown).child(h);
                    if has_rest {
                        s.child(h.absolute().right_0().top_0().bottom_0())
                    } else {
                        s.child(h)
                    }
                })
        });
        let (trailing, corner) = if self.rail { (None, trailing) } else { (trailing, None) };
        // Screen readers: a button named by its label, the detail as its description, selected when open.
        let label = self.label.clone();
        let description = self.detail.as_ref().map(|(d, _)| d.clone());
        let key = self.id.clone();
        // A grip on hover (or while dragged) at the row's start, its middle on the row's edge.
        let grip = (self.reorder.is_some() && !self.rail).then(|| {
            let shown = gpui_kit::base::transition(
                ElementId::from(SharedString::from(format!("{}-grip", self.id))),
                if hovered || self.lifted { 1. } else { 0. },
                gpui_kit::base::Transition::new(motion::ms(motion::HOVER_MS)),
                window,
                cx,
            );
            div()
                .absolute()
                .top_0()
                .bottom_0()
                .left(px(-icon::XS / 2.))
                .flex()
                .items_center()
                .opacity(shown)
                .child(icon(IconName::GripVertical, icon::XS).text_color(p.text_dim))
        });
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
            .relative()
            .rounded(px(tokens::RADIUS_ROW))
            .bg(bg)
            // Its ghost follows the pointer: the row's own place stays open (it keeps its size).
            .when(self.lifted, |r| r.opacity(0.))
            .text_color(fg)
            .children(grip)
            .when(self.disabled, |r| r.opacity(0.45))
            .when(self.active || self.emphasis, |r| r.font_weight(FontWeight::MEDIUM))
            .map(|r| {
                if self.rail {
                    r.size(px(tokens::CONTROL_H)).justify_center() // the rail's square, as every rail item
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
            // On the rail what the row shows on the right (a count) sits on the square's top-right corner.
            .when(self.rail, |r| {
                r.when_some(corner, |r, t| {
                    r.child(div().absolute().top(px(-2.)).right(px(-2.)).child(t))
                })
            })
            .when(!self.disabled, |r| {
                r.when_some(self.on_click, |r, handler| r.on_click(handler))
            });
        let row = match self.reorder {
            Some((this_row, on_over, on_drop)) => {
                let over_row = this_row.clone();
                row.on_drag(this_row, |row, _, _, cx| {
                    cx.new(|_| crate::ui::reorder::Ghost(row.clone()))
                })
                .on_drag_move::<DragRow>(move |event, window, cx| {
                    if !event.bounds.contains(&event.event.position) {
                        return;
                    }
                    let dragged = event.drag(cx).clone();
                    if dragged.group != over_row.group || dragged.id == over_row.id {
                        return;
                    }
                    let after = event.event.position.y > event.bounds.center().y;
                    on_over(&dragged, &over_row, after, window, cx);
                })
                .on_drop(move |dragged: &DragRow, window, cx| on_drop(dragged, window, cx))
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
