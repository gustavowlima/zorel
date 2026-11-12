// Zorel's menu (apps/web/src/ui/menu.tsx): one list of actions, opened by a right-click where the pointer is or by a
// ⋯ button under it. It floats on `layout::float` (card radius, inset 6) with 32px rows at the row radius, concentric;
// a focused row speaks its own voice (accent wash, or danger for a destructive one). It enters in 140ms (fade and a
// 4px rise, Zeron's MENU_IN), and closes on a pick, a click outside or Escape.
use std::rc::Rc;

use gpui_kit::{
    assets::IconName,
    component::{Selectable, popover::Popover},
    prelude::FluentBuilder,
    *,
};

use crate::ui::space;
use crate::{
    theme::{self, tokens},
    ui::{
        icon::{self, icon},
        layout, motion,
    },
};

pub type Action = Rc<dyn Fn(&mut Window, &mut App) + 'static>;

#[derive(Clone)]
pub enum Entry {
    Item {
        label: SharedString,
        icon: Option<IconName>,
        danger: bool,
        action: Action,
    },
    Separator,
}

/// A menu's entries, built when it opens (so they read the state of that moment).
pub type Items = Rc<dyn Fn() -> Vec<Entry> + 'static>;

/// Builds a menu's entries.
#[derive(Default)]
pub struct Menu(Vec<Entry>);

impl Menu {
    pub fn item(mut self, label: impl Into<SharedString>, action: impl Fn(&mut Window, &mut App) + 'static) -> Self {
        self.0.push(Entry::Item {
            label: label.into(),
            icon: None,
            danger: false,
            action: Rc::new(action),
        });
        self
    }

    /// A destructive action (Delete): red, and red when focused.
    pub fn danger(mut self, label: impl Into<SharedString>, action: impl Fn(&mut Window, &mut App) + 'static) -> Self {
        self.0.push(Entry::Item {
            label: label.into(),
            icon: None,
            danger: true,
            action: Rc::new(action),
        });
        self
    }

    pub fn separator(mut self) -> Self {
        self.0.push(Entry::Separator);
        self
    }

    pub fn build(self) -> Vec<Entry> {
        self.0
    }
}

/// Where a right-click opened the menu (None: closed), and the focus that takes Escape.
struct Open {
    at: Option<Point<Pixels>>,
    focus: FocusHandle,
}

/// Gives `element` a menu on right-click, at the pointer.
pub fn on_right_click<E>(key: &ElementId, element: E, items: Items, window: &mut Window, cx: &mut App) -> AnyElement
where
    E: InteractiveElement + ParentElement + IntoElement + FluentBuilder + 'static,
{
    let state = window.use_keyed_state(
        ElementId::from(SharedString::from(format!("{key}-menu"))),
        cx,
        |_, cx| Open {
            at: None,
            focus: cx.focus_handle(),
        },
    );
    let (at, focus) = {
        let s = state.read(cx);
        (s.at, s.focus.clone())
    };
    let opener = state.clone();
    let element = element.on_mouse_down(MouseButton::Right, move |event, window, cx| {
        cx.stop_propagation();
        opener.update(cx, |s, cx| {
            s.at = Some(event.position);
            s.focus.focus(window, cx);
            cx.notify();
        });
    });
    let Some(at) = at else {
        return element.into_any_element();
    };
    let close = {
        let state = state.clone();
        Rc::new(move |_: &mut Window, cx: &mut App| {
            state.update(cx, |s, cx| {
                s.at = None;
                cx.notify();
            })
        })
    };
    let (outside, escape) = (close.clone(), close.clone());
    let list = surface(key, items(), close, window, cx)
        .track_focus(&focus)
        .on_mouse_down_out(move |_, window, cx| outside(window, cx))
        .on_key_down(move |event, window, cx| {
            if event.keystroke.key == "escape" {
                escape(window, cx);
            }
        });
    let list = enter(list, key);
    element
        .child(deferred(anchored().position(at).snap_to_window_with_margin(px(8.)).child(list)).with_priority(1))
        .into_any_element()
}

/// A ⋯ button (or any trigger) that opens the menu under it.
pub fn dropdown<T: Selectable + IntoElement + 'static>(key: impl Into<ElementId>, trigger: T, items: Items) -> Popover {
    let key: ElementId = key.into();
    let id = key.clone();
    Popover::new(key)
        .anchor(Anchor::TopRight)
        .offset(px(4.))
        .appearance(false)
        .trigger(trigger)
        .content(move |_, window, cx| {
            let popover = cx.entity();
            let close: Action = Rc::new(move |window, cx| popover.update(cx, |s, cx| s.dismiss(window, cx)));
            enter(surface(&id, items(), close, window, cx), &id)
        })
}

/// The floating list itself.
fn surface(key: &ElementId, entries: Vec<Entry>, close: Action, window: &mut Window, cx: &mut App) -> Stateful<Div> {
    let p = theme::palette(window);
    let rows = entries.into_iter().enumerate().map(|(i, entry)| match entry {
        Entry::Separator => div()
            .my(px(space::X1_5))
            .mx(px(space::X2_5))
            .h(px(1.))
            .bg(p.border)
            .into_any_element(),
        Entry::Item {
            label,
            icon: mark,
            danger,
            action,
        } => {
            let id = ElementId::from(SharedString::from(format!("{key}-item-{i}")));
            let pointer = motion::pointer(&id, window, cx);
            let hovered = pointer.read(cx).hovered;
            let (wash, fg) = match danger {
                true => (p.danger_soft, p.danger),
                false => (p.accent_soft, if hovered { p.text } else { p.text_secondary }),
            };
            let bg = motion::color(
                &id,
                "bg",
                if hovered { wash } else { Rgba { a: 0., ..wash } },
                window,
                cx,
            );
            let close = close.clone();
            let row = div()
                .id(id.clone())
                .role(Role::MenuItem)
                .aria_label(label.clone())
                .flex()
                .items_center()
                .gap(px(space::X2))
                .h(px(tokens::CONTROL_H)) // a comfortable row: the sidebar's height
                .px(px(space::X2_5))
                .rounded(px(tokens::RADIUS_ROW))
                .bg(bg)
                .text_color(fg)
                .when_some(mark, |r, name| {
                    r.child(icon(name, icon::MD).text_color(if hovered && !danger { p.accent_text } else { fg }))
                })
                .child(div().truncate().child(label))
                .on_click(move |_, window, cx| {
                    close(window, cx);
                    action(window, cx);
                });
            motion::track(row, &pointer).into_any_element()
        }
    });
    let id = ElementId::from(SharedString::from(format!("{key}-surface")));
    layout::float(div().id(id), p)
        .occlude()
        .role(Role::Menu)
        .min_w(px(192.))
        .flex()
        .flex_col()
        .children(rows)
}

/// Enters on Zeron's MENU_IN: 140ms, a fade and a 4px rise.
fn enter(surface: Stateful<Div>, key: &ElementId) -> AnyElement {
    surface
        .with_animation(
            ElementId::from(SharedString::from(format!("{key}-enter"))),
            Animation::new(motion::ms(motion::MENU_IN_MS)).with_easing(motion::ease_out_quint),
            |el, t| el.opacity(t).mt(px(space::X1 * (1. - t))),
        )
        .into_any_element()
}
