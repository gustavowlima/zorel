// Micro-interactions shared by Zorel's native controls (spec 019, "more fluid identity"): hover and press are tracked
// per element, colours ease between states and a press sinks the control by a pixel on a spring (velocity carries
// over if you let go mid-way). GPUI has no element scale transform, so the press reads as depth, not shrink.
// Everything here goes through gpui-base's transition/spring, which honour reduced motion.
use std::time::Duration;

use gpui_kit::{
    base::{Spring, Transition, spring, transition},
    *,
};

/// A control's live pointer state, kept across renders under its element id.
#[derive(Default, Clone, Copy)]
pub struct Pointer {
    pub hovered: bool,
    pub pressed: bool,
}

pub fn pointer(id: &ElementId, window: &mut Window, cx: &mut App) -> Entity<Pointer> {
    window.use_keyed_state(
        ElementId::from(SharedString::from(format!("{id}-pointer"))),
        cx,
        |_, _| Pointer::default(),
    )
}

/// Wires hover and press tracking onto a stateful element.
pub fn track<E: StatefulInteractiveElement + InteractiveElement>(element: E, state: &Entity<Pointer>) -> E {
    let (hover, down, up, out) = (state.clone(), state.clone(), state.clone(), state.clone());
    element
        .on_hover(move |hovered, _, cx| {
            hover.update(cx, |p, cx| {
                p.hovered = *hovered;
                if !*hovered {
                    p.pressed = false;
                }
                cx.notify();
            })
        })
        .on_mouse_down(MouseButton::Left, move |_, _, cx| {
            down.update(cx, |p, cx| set_pressed(p, true, cx))
        })
        .on_mouse_up(MouseButton::Left, move |_, _, cx| {
            up.update(cx, |p, cx| set_pressed(p, false, cx))
        })
        .on_mouse_up_out(MouseButton::Left, move |_, _, cx| {
            out.update(cx, |p, cx| set_pressed(p, false, cx))
        })
}

fn set_pressed(p: &mut Pointer, pressed: bool, cx: &mut Context<Pointer>) {
    p.pressed = pressed;
    cx.notify();
}

/// A colour that eases to `target` (≈120 ms, the web's --duration for controls).
pub fn color(id: &ElementId, channel: &str, target: Rgba, window: &mut Window, cx: &mut App) -> Hsla {
    let key = ElementId::from(SharedString::from(format!("{id}-{channel}")));
    transition(
        key,
        Hsla::from(target),
        Transition::new(Duration::from_millis(120)),
        window,
        cx,
    )
}

/// How far the control sinks: 1 px while pressed, back up on a quick, slightly bouncy spring.
pub fn sink(id: &ElementId, pressed: bool, window: &mut Window, cx: &mut App) -> Pixels {
    let key = ElementId::from(SharedString::from(format!("{id}-sink")));
    spring(
        key,
        px(if pressed { 1. } else { 0. }),
        Spring::new(Duration::from_millis(220)).with_damping(0.7),
        window,
        cx,
    )
}
