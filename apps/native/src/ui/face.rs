// The agent's face (spec 018/019, apps/web/src/ui/face.tsx): a circle in its hue with two white pill eyes a touch
// above centre; its state lives on it. Working = a flat ring in the hue (35%) with one dot travelling round it;
// waiting = an amber dot at the top right; done / failed = a green / red dot at the bottom right. Geometry from the
// --z-eye-* / --z-ring-* tokens. GPUI animations stop under reduced motion (cx.reduce_motion()).
// ponytail: the alive eyes (glance, blink) and the waiting dot's breathing come with T067.
use std::{f32::consts::TAU, time::Duration};

use gpui_kit::{prelude::FluentBuilder, *};

use crate::{
    theme::{self, tokens},
    ui::motion,
};

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum FaceState {
    Idle,
    Working,
    Waiting,
    Done,
    Failed,
}

/// The eyes' expression in an illustration (ui/scene.rs): open, happy (two little arcs), asleep (two short lines),
/// looking aside, looking up.
#[derive(Clone, Copy, PartialEq, Eq, Debug, Default)]
pub enum Eyes {
    #[default]
    Open,
    Happy,
    Asleep,
    Aside,
    Up,
}

/// An agent's face; `tone` picks its hue (one of six, in the agents' order).
#[derive(IntoElement)]
pub struct AgentFace {
    id: ElementId,
    tone: usize,
    size: f32,
    state: FaceState,
    eyes: Eyes,
    /// A solid colour instead of the hue's tint, and the ring cut out of what's behind it (an illustration).
    solid: Option<(Rgba, Rgba)>,
}

impl AgentFace {
    pub fn new(id: impl Into<ElementId>, tone: usize) -> Self {
        Self {
            id: id.into(),
            tone,
            size: 20.,
            state: FaceState::Idle,
            eyes: Eyes::Open,
            solid: None,
        }
    }

    pub fn eyes(mut self, eyes: Eyes) -> Self {
        self.eyes = eyes;
        self
    }

    /// Filled with `color`, a ring of `cut` (the background behind it) around it.
    pub fn solid(mut self, color: Rgba, cut: Rgba) -> Self {
        self.solid = Some((color, cut));
        self
    }

    pub fn size(mut self, size: f32) -> Self {
        self.size = size;
        self
    }

    pub fn state(mut self, state: FaceState) -> Self {
        self.state = state;
        self
    }
}

/// The six agent hues, in order (`--z-agent-1…6`).
pub fn hue(palette: &tokens::Palette, tone: usize) -> Rgba {
    [
        palette.agent_1,
        palette.agent_2,
        palette.agent_3,
        palette.agent_4,
        palette.agent_5,
        palette.agent_6,
    ][tone % 6]
}

/// `color-mix(in srgb, a share, b)`: faces in lists overlap, so the tint is mixed into the raised tone and stays opaque.
/// (The web mixes in oklab; sRGB is close enough at 26% and costs nothing.)
pub fn mix(a: Rgba, share: f32, b: Rgba) -> Rgba {
    let m = |x: f32, y: f32| x * share + y * (1. - share);
    Rgba {
        r: m(a.r, b.r),
        g: m(a.g, b.g),
        b: m(a.b, b.b),
        a: 1.,
    }
}

const TINT: f32 = 0.26;

/// Where the pointer is and where every face was drawn: faces look toward a pointer that comes near.
#[derive(Default)]
pub struct Gaze {
    pointer: Option<Point<Pixels>>,
    faces: std::collections::HashMap<ElementId, Bounds<Pixels>>,
}

impl Global for Gaze {}

/// How near the pointer must come for a face to look at it: a few faces' widths from its centre.
const REACH: f32 = 3.;

fn reach(size: f32) -> f32 {
    size * REACH
}

/// The window's pointer moved (Root calls this): faces near it redraw to follow it.
pub fn follow(position: Point<Pixels>, window: &mut Window, cx: &mut App) {
    let gaze = cx.default_global::<Gaze>();
    let near = |p: Point<Pixels>| {
        gaze.faces
            .values()
            .any(|b| distance(b.center(), p) < reach(f32::from(b.size.width)) * 1.2)
    };
    let wake = near(position) || gaze.pointer.is_some_and(near);
    gaze.pointer = Some(position);
    if wake {
        window.refresh();
    }
}

fn distance(a: Point<Pixels>, b: Point<Pixels>) -> f32 {
    let (dx, dy) = (f32::from(a.x - b.x), f32::from(a.y - b.y));
    (dx * dx + dy * dy).sqrt()
}

/// Where the eyes look: toward the pointer, up to `max` px, more the nearer it is; centred when it's far.
fn look(center: Point<Pixels>, pointer: Option<Point<Pixels>>, size: f32) -> (f32, f32) {
    let Some(p) = pointer else { return (0., 0.) };
    let (dx, dy) = (f32::from(p.x - center.x), f32::from(p.y - center.y));
    let d = (dx * dx + dy * dy).sqrt();
    let range = reach(size);
    if d < 1. || d > range {
        return (0., 0.);
    }
    let pull = size * 0.08 * (1. - d / range).clamp(0.35, 1.);
    (dx / d * pull, dy / d * pull)
}

/// How a blink feels: the eyes close to a line and open again in BLINK_MS, at the start of each EVERY_MS while the
/// pointer stays on the face (so it blinks as you arrive, then now and then, like a person).
const BLINK_MS: f32 = 200.;
const EVERY_MS: u64 = 2600;

/// The eyes' height (1 = open) at `t` of a blink cycle.
fn blink(t: f32) -> f32 {
    let at = t * EVERY_MS as f32;
    if at >= BLINK_MS {
        return 1.;
    }
    1. - 0.88 * (at / BLINK_MS * std::f32::consts::PI).sin()
}

impl RenderOnce for AgentFace {
    fn render(self, window: &mut Window, cx: &mut App) -> impl IntoElement {
        let p = theme::palette(window);
        let hue = hue(p, self.tone);
        let s = self.size;
        // It looks toward the pointer when it comes near (springing), and blinks when the pointer lands on it.
        let bounds = cx.default_global::<Gaze>().faces.get(&self.id).copied();
        let pointer = cx.default_global::<Gaze>().pointer;
        let (lx, ly) = bounds.map_or((0., 0.), |b| look(b.center(), pointer, s));
        let key = self.id.to_string();
        let ox = gpui_kit::base::spring(
            SharedString::from(format!("{key}-look-x")),
            px(lx),
            motion::settle(motion::SETTLE_MS),
            window,
            cx,
        );
        let oy = gpui_kit::base::spring(
            SharedString::from(format!("{key}-look-y")),
            px(ly),
            motion::settle(motion::SETTLE_MS),
            window,
            cx,
        );
        let hover = motion::pointer(&self.id, window, cx);
        let hovered = hover.read(cx).hovered;
        let blinks = window.use_keyed_state(ElementId::from(format!("{key}-blinks")), cx, |_, _| (false, 0u32));
        let (was, mut count) = *blinks.read(cx);
        if hovered && !was {
            count += 1;
        }
        if hovered != was {
            blinks.update(cx, |b, _| *b = (hovered, count));
        }
        let eye_h = s * tokens::EYE_H;
        let eyes = self.eyes;
        let eye = |n: usize| {
            // An expression is drawn as it is: no blink, no glance.
            match eyes {
                Eyes::Happy => {
                    return div()
                        .w(px(s * 0.22))
                        .h(px(s * 0.11))
                        .mt(px(-s * 0.04))
                        .border_t_2()
                        .border_l_2()
                        .border_r_2()
                        .border_color(p.eye)
                        .rounded_t_full()
                        .into_any_element();
                }
                Eyes::Asleep => {
                    return div()
                        .w(px(s * 0.2))
                        .h(px((s * 0.05).max(1.5)))
                        .mt(px(s * 0.04))
                        .rounded_full()
                        .bg(p.eye)
                        .into_any_element();
                }
                Eyes::Open | Eyes::Aside | Eyes::Up => {}
            }
            let e = div()
                .w(px(s * tokens::EYE_W))
                .h(px(eye_h))
                .mt(px(-s * tokens::EYE_LIFT))
                .rounded_full()
                .bg(p.eye);
            // Blinks while the pointer is on it (a new hover starts the rhythm again).
            if !hovered {
                return e.into_any_element();
            }
            e.with_animation(
                SharedString::from(format!("{key}-blink-{count}-{n}")),
                Animation::new(motion::ms(EVERY_MS)).repeat(),
                move |el, t| el.h(px(eye_h * blink(t))),
            )
            .into_any_element()
        };
        let mark = |color: Rgba, top: bool| {
            let d = (s * 0.28).round().max(6.);
            div()
                .absolute()
                .right(px(-2.))
                .when(top, |m| m.top(px(-2.)))
                .when(!top, |m| m.bottom(px(-2.)))
                .size(px(d))
                .rounded_full()
                .bg(color)
                .border_2()
                .border_color(p.bg_canvas)
        };
        let id = self.id.clone();
        let face = div()
            .id(self.id)
            .relative()
            .flex()
            .flex_none()
            .items_center()
            .justify_center()
            .size(px(s))
            .rounded_full()
            .map(|f| match self.solid {
                Some((color, cut)) => f.bg(color).border_3().border_color(cut),
                None => f.bg(mix(hue, TINT, p.bg_raised)),
            })
            .child(
                div()
                    .relative()
                    .map(|d| match eyes {
                        Eyes::Aside => d.left(px(s * tokens::EYE_W * 0.55)),
                        Eyes::Up => d.top(px(-eye_h * 0.35)),
                        Eyes::Happy | Eyes::Asleep => d,
                        Eyes::Open => d.left(ox).top(oy),
                    })
                    .flex()
                    .items_center()
                    .gap(px(s * tokens::EYE_GAP))
                    .child(eye(0))
                    .child(eye(1)),
            )
            .when(self.state == FaceState::Working, |f| {
                f.child(ring(hue, s, if s <= 20. { 3. } else { 4. }, 5.))
            })
            .when(self.state == FaceState::Waiting, |f| f.child(mark(p.warning, true)))
            .when(self.state == FaceState::Done, |f| f.child(mark(p.success, false)))
            .when(self.state == FaceState::Failed, |f| f.child(mark(p.danger, false)));
        let face = motion::track(face, &hover);
        // Where it was drawn, so it knows where to look next frame.
        div()
            .flex_none()
            .on_children_prepainted(move |b, _, cx| {
                if let Some(b) = b.first() {
                    cx.default_global::<Gaze>().faces.insert(id.clone(), *b);
                }
            })
            .child(face)
    }
}

/// The working ring on its own (a step, a status line), in an agent's hue or the given colour.
#[derive(IntoElement)]
pub struct WorkingRing {
    id: ElementId,
    size: f32,
    color: Option<Rgba>,
}

impl WorkingRing {
    pub fn new(id: impl Into<ElementId>) -> Self {
        Self {
            id: id.into(),
            size: 14.,
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

impl RenderOnce for WorkingRing {
    fn render(self, window: &mut Window, _: &mut App) -> impl IntoElement {
        let color = self.color.unwrap_or(theme::palette(window).text_secondary);
        div()
            .id(self.id)
            .relative()
            .flex_none()
            .size(px(self.size))
            .child(ring(color, self.size, 0., 4.))
    }
}

// A ring `gap` px outside a box of `size`, with a dot of `dot` px going round it once per --z-ring-turn.
fn ring(color: Rgba, size: f32, gap: f32, dot: f32) -> impl IntoElement {
    let d = size + gap * 2.;
    let r = d / 2.;
    let faint = Rgba { a: 0.35, ..color };
    div()
        .absolute()
        .top(px(-gap))
        .left(px(-gap))
        .size(px(d))
        .rounded_full()
        .border(px(tokens::RING_W))
        .border_color(faint)
        .child(div().absolute().size(px(dot)).rounded_full().bg(color).with_animation(
            "turn",
            Animation::new(Duration::from_millis(tokens::RING_TURN as u64)).repeat(),
            move |dot_el, t| {
                // Clockwise from 12 o'clock, centred on the ring's line.
                let angle = t * TAU;
                let (x, y) = (r + (r - 0.75) * angle.sin(), r - (r - 0.75) * angle.cos());
                dot_el
                    .left(px(x - dot / 2. - tokens::RING_W))
                    .top(px(y - dot / 2. - tokens::RING_W))
            },
        ))
}

#[cfg(test)]
mod gaze_tests {
    use gpui_kit::{point, px};

    use super::{blink, look, reach};

    #[test]
    fn a_blink_closes_then_the_eyes_stay_open_until_the_next() {
        assert!(blink(0.) > 0.99);
        assert!(blink(0.1 / 2.6 * 1.) > 0.); // ~100ms in: closing
        assert!(blink(100. / 2600.) < 0.2); // the middle of the blink: nearly shut
        assert!((blink(0.5) - 1.).abs() < 1e-6); // between blinks: open
    }

    #[test]
    fn eyes_look_toward_a_near_pointer_and_rest_when_it_is_far() {
        let center = point(px(100.), px(100.));
        let (x, y) = look(center, Some(point(px(130.), px(100.))), 20.);
        assert!(x > 0. && x <= 1.6 && y.abs() < 1e-5); // at most 8% of a 20px face
        assert_eq!(
            look(center, Some(point(px(100. + reach(20.) + 1.), px(100.))), 20.),
            (0., 0.)
        );
        assert_eq!(look(center, None, 20.), (0., 0.));
    }
}
