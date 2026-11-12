// Micro-interactions shared by Zorel's native controls (spec 019, "more fluid identity"): hover and press are tracked
// per element, colours ease between states and a press sinks the control by a pixel on a spring (velocity carries
// over if you let go mid-way). GPUI has no element scale transform, so the press reads as depth, not shrink.
// Everything here goes through gpui-base's transition/spring, which honour reduced motion.
use std::time::Duration;

use gpui_kit::{
    base::{Spring, Transition, spring, transition},
    *,
};

// The motion catalog: every duration in the app is one of these (Zeron's practice: one place, named by purpose), so
// controls, lists and menus move alike. `ZOREL_MOTION_SCALE=10` stretches them all for frame-by-frame checks.

/// A colour easing between states (hover, focus, selection).
pub const HOVER_MS: u64 = 150;
/// A press sinking and springing back.
pub const PRESS_MS: u64 = 220;
/// Something opening or closing in place (the sidebar's width, a section's chevron).
pub const SETTLE_MS: u64 = 200;
/// A marker moving to the new choice (segmented, tabs).
pub const SLIDE_MS: u64 = 260;
/// A menu or select list entering.
pub const MENU_IN_MS: u64 = 140;
/// A screen (page) coming in when you go somewhere: a fade and a short rise.
pub const PAGE_MS: u64 = 180;
/// A new row joining a list (a message arriving).
pub const ENTER_MS: u64 = 220;

/// Fades `element` in while it rises `rise` px, once per `key` (a new key plays it again).
pub fn enter<E: IntoElement + Styled + 'static>(
    element: E,
    key: impl Into<ElementId>,
    ms_: u64,
    rise: f32,
) -> AnyElement {
    element
        .with_animation(
            key,
            Animation::new(ms(ms_)).with_easing(ease_out_quint),
            move |el, t| el.opacity(t).relative().top(px(rise * (1. - t))),
        )
        .into_any_element()
}

/// A catalog duration, scaled by `ZOREL_MOTION_SCALE` (development) when set.
pub fn ms(ms: u64) -> Duration {
    static SCALE: std::sync::OnceLock<f64> = std::sync::OnceLock::new();
    let scale = *SCALE.get_or_init(|| {
        std::env::var("ZOREL_MOTION_SCALE")
            .ok()
            .and_then(|v| v.parse().ok())
            .filter(|s: &f64| *s > 0.)
            .unwrap_or(1.)
    });
    Duration::from_secs_f64(ms as f64 / 1000. * scale)
}

/// Settling without overshoot (open/close, slides).
pub fn settle(ms_: u64) -> Spring {
    Spring::new(ms(ms_)).with_damping(1.)
}

/// Zeron's EASE_OUT_QUINT feel for entrances: fast out, soft landing.
pub fn ease_out_quint(t: f32) -> f32 {
    1. - (1. - t).powi(5)
}

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

/// A colour that eases to `target` (HOVER_MS), mixed with premultiplied alpha: a fade from transparent, or between
/// washes of different tones, never passes through a darker or brighter colour (HSLA mixing does, and it flashes).
pub fn color(id: &ElementId, channel: &str, target: Rgba, window: &mut Window, cx: &mut App) -> Hsla {
    let key = ElementId::from(SharedString::from(format!("{id}-{channel}")));
    let paint = transition(key, Paint::from(target), Transition::new(ms(HOVER_MS)), window, cx);
    Hsla::from(Rgba::from(paint))
}

/// A colour with premultiplied alpha, the space colours mix in without fringes.
#[derive(Clone, Copy, PartialEq, Debug)]
pub struct Paint([f32; 4]);

impl From<Rgba> for Paint {
    fn from(c: Rgba) -> Self {
        Self([c.r * c.a, c.g * c.a, c.b * c.a, c.a])
    }
}

impl From<Paint> for Rgba {
    fn from(Paint([r, g, b, a]): Paint) -> Self {
        if a <= f32::EPSILON {
            return Rgba {
                r: 0.,
                g: 0.,
                b: 0.,
                a: 0.,
            };
        }
        Rgba {
            r: r / a,
            g: g / a,
            b: b / a,
            a,
        }
    }
}

impl gpui_kit::base::Interpolate for Paint {
    fn interpolate(&self, target: &Self, progress: f32) -> Self {
        let mix = |i: usize| self.0[i] + (target.0[i] - self.0[i]) * progress;
        Self([mix(0), mix(1), mix(2), mix(3)])
    }
}

/// `color` at `share` of its alpha (a lighter wash of the same tone).
pub fn fade(color: Rgba, share: f32) -> Rgba {
    Rgba {
        a: color.a * share,
        ..color
    }
}

/// How far the control sinks: 1 px while pressed, back up on a quick, slightly bouncy spring.
pub fn sink(id: &ElementId, pressed: bool, window: &mut Window, cx: &mut App) -> Pixels {
    let key = ElementId::from(SharedString::from(format!("{id}-sink")));
    spring(
        key,
        px(if pressed { 1. } else { 0. }),
        Spring::new(ms(PRESS_MS)).with_damping(0.7),
        window,
        cx,
    )
}

#[cfg(test)]
mod tests {
    use gpui_kit::{Rgba, base::Interpolate as _};

    use super::Paint;

    #[test]
    fn a_fade_from_transparent_keeps_its_tone() {
        let white = Rgba {
            r: 1.,
            g: 1.,
            b: 1.,
            a: 0.1,
        };
        let clear = Rgba {
            r: 0.,
            g: 0.,
            b: 0.,
            a: 0.,
        };
        let mid = Rgba::from(Paint::from(clear).interpolate(&Paint::from(white), 0.5));
        assert!((mid.r - 1.).abs() < 1e-5 && (mid.a - 0.05).abs() < 1e-5);
    }
}
