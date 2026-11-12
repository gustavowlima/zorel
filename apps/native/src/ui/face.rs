// The agent's face (spec 018/019, apps/web/src/ui/face.tsx): a circle in its hue with two white pill eyes a touch
// above centre; its state lives on it. Working = a flat ring in the hue (35%) with one dot travelling round it;
// waiting = an amber dot at the top right; done / failed = a green / red dot at the bottom right. Geometry from the
// --z-eye-* / --z-ring-* tokens. GPUI animations stop under reduced motion (cx.reduce_motion()).
// ponytail: the alive eyes (glance, blink) and the waiting dot's breathing come with T067.
use std::{f32::consts::TAU, time::Duration};

use gpui_kit::{prelude::FluentBuilder, *};

use crate::theme::{self, tokens};

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum FaceState {
    Idle,
    Working,
    Waiting,
    Done,
    Failed,
}

/// An agent's face; `tone` picks its hue (one of six, in the agents' order).
#[derive(IntoElement)]
pub struct AgentFace {
    id: ElementId,
    tone: usize,
    size: f32,
    state: FaceState,
}

impl AgentFace {
    pub fn new(id: impl Into<ElementId>, tone: usize) -> Self {
        Self {
            id: id.into(),
            tone,
            size: 20.,
            state: FaceState::Idle,
        }
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

impl RenderOnce for AgentFace {
    fn render(self, window: &mut Window, _: &mut App) -> impl IntoElement {
        let p = theme::palette(window);
        let hue = hue(p, self.tone);
        let s = self.size;
        let eye = || {
            div()
                .w(px(s * tokens::EYE_W))
                .h(px(s * tokens::EYE_H))
                .mt(px(-s * tokens::EYE_LIFT))
                .rounded_full()
                .bg(p.eye)
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
        div()
            .id(self.id)
            .relative()
            .flex()
            .flex_none()
            .items_center()
            .justify_center()
            .gap(px(s * tokens::EYE_GAP))
            .size(px(s))
            .rounded_full()
            .bg(mix(hue, TINT, p.bg_raised))
            .child(eye())
            .child(eye())
            .when(self.state == FaceState::Working, |f| {
                f.child(ring(hue, s, if s <= 20. { 3. } else { 4. }, 5.))
            })
            .when(self.state == FaceState::Waiting, |f| f.child(mark(p.warning, true)))
            .when(self.state == FaceState::Done, |f| f.child(mark(p.success, false)))
            .when(self.state == FaceState::Failed, |f| f.child(mark(p.danger, false)))
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
