// The new chat's backdrop (apps/web/src/ui/orbit.tsx), after Zorel's mark: five barely-there concentric orbits in the
// border's tone, two spokes coming in from opposite corners ending in accent dots, and four agents (accent dots)
// slowly circling. Drawn on a canvas in the SVG's own coordinates (viewBox -600..600, "slice"), faded toward the edges
// by the web's radial mask (ellipse 60% 55% at 50% 45%: .25 in the middle, full at 35%, gone at 72%). Decoration only:
// no hit testing, and the agents stand still under reduced motion.
use std::time::{Duration, Instant};

use gpui_kit::*;

use crate::theme;

const RINGS: [f32; 5] = [110., 200., 300., 410., 530.];
/// Each agent: its orbit, where on it it starts (degrees), its radius, and how long one turn takes (seconds).
const AGENTS: [(f32, f32, f32, f32); 4] = [
    (200., 215., 2.5, 140.),
    (300., 40., 2., 200.),
    (410., 160., 1.75, 260.),
    (300., 290., 1.5, 200.),
];
/// Half the SVG's square viewBox.
const HALF: f32 = 600.;
/// How often the agents step: they move under a pixel per step, so this reads as a glide without redrawing every frame.
const STEP: Duration = Duration::from_millis(125);
/// Segments per ring: the mask's fade varies along each one.
const SEGMENTS: usize = 96;
/// Alpha levels the fade is drawn in (one path each).
const LEVELS: usize = 16;

pub struct Orbit {
    start: Instant,
    _tick: Option<Task<()>>,
}

impl Orbit {
    pub fn new(cx: &mut Context<Self>) -> Self {
        let tick = (!cx.reduce_motion()).then(|| {
            cx.spawn(async move |this, cx| {
                loop {
                    cx.background_executor().timer(STEP).await;
                    if this.update(cx, |_, cx| cx.notify()).is_err() {
                        break;
                    }
                }
            })
        });
        Self {
            start: Instant::now(),
            _tick: tick,
        }
    }
}

impl Render for Orbit {
    fn render(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let p = theme::palette(window);
        let (line, accent) = (p.border, p.accent);
        let t = if cx.reduce_motion() {
            0.
        } else {
            self.start.elapsed().as_secs_f32()
        };
        canvas(
            |_, _, _| (),
            move |bounds, _, window, _| paint(bounds, line, accent, t, window),
        )
        .size_full()
    }
}

/// The web's mask at a point of a `w`×`h` box: how much of the drawing shows there (0..1).
pub fn mask(x: f32, y: f32, w: f32, h: f32) -> f32 {
    let (rx, ry) = (0.6 * w, 0.55 * h);
    if rx <= 0. || ry <= 0. {
        return 0.;
    }
    let (dx, dy) = ((x - 0.5 * w) / rx, (y - 0.45 * h) / ry);
    let d = (dx * dx + dy * dy).sqrt();
    if d <= 0.35 {
        0.25 + 0.75 * d / 0.35
    } else if d <= 0.72 {
        1. - (d - 0.35) / 0.37
    } else {
        0.
    }
}

/// Where an agent is after `t` seconds, in SVG units (y down, clockwise as CSS rotates).
pub fn agent_at(r: f32, at: f32, turn: f32, t: f32) -> (f32, f32) {
    let angle = (at + 360. * (t / turn).fract()).to_radians();
    (r * angle.cos(), r * angle.sin())
}

fn paint(bounds: Bounds<Pixels>, line: Rgba, accent: Rgba, t: f32, window: &mut Window) {
    let (w, h) = (f32::from(bounds.size.width), f32::from(bounds.size.height));
    if w <= 0. || h <= 0. {
        return;
    }
    // "slice": the square covers the box, centred.
    let scale = w.max(h) / (2. * HALF);
    let to_box = |x: f32, y: f32| (w / 2. + x * scale, h / 2. + y * scale);
    let at = |(x, y): (f32, f32)| point(bounds.origin.x + px(x), bounds.origin.y + px(y));

    // The lines (rings and spokes) in short segments, grouped by how much of them the mask lets through.
    let mut levels: Vec<Option<PathBuilder>> = (0..LEVELS).map(|_| None).collect();
    let mut segment = |a: (f32, f32), b: (f32, f32)| {
        let (a, b) = (to_box(a.0, a.1), to_box(b.0, b.1));
        let alpha = mask((a.0 + b.0) / 2., (a.1 + b.1) / 2., w, h);
        let level = (alpha * (LEVELS - 1) as f32).round() as usize;
        if level == 0 {
            return;
        }
        let path = levels[level].get_or_insert_with(|| PathBuilder::stroke(px(1.)));
        path.move_to(at(a));
        path.line_to(at(b));
    };
    for r in RINGS {
        for i in 0..SEGMENTS {
            let (a0, a1) = (
                i as f32 / SEGMENTS as f32 * std::f32::consts::TAU,
                (i + 1) as f32 / SEGMENTS as f32 * std::f32::consts::TAU,
            );
            segment((r * a0.cos(), r * a0.sin()), (r * a1.cos(), r * a1.sin()));
        }
    }
    // The two spokes, as the mark's arcs meet its core from opposite corners.
    for sign in [-1., 1.] {
        for i in 0..16 {
            let (f0, f1) = (i as f32 / 16., (i + 1) as f32 / 16.);
            let along = |f: f32| sign * (420. - 340. * f);
            segment((along(f0), along(f0)), (along(f1), along(f1)));
        }
    }
    for (level, path) in levels.into_iter().enumerate() {
        let Some(Ok(path)) = path.map(PathBuilder::build) else {
            continue;
        };
        let alpha = level as f32 / (LEVELS - 1) as f32;
        window.paint_path(
            path,
            Rgba {
                a: line.a * alpha,
                ..line
            },
        );
    }

    let mut dot = |(x, y): (f32, f32), r: f32, opacity: f32| {
        let (bx, by) = to_box(x, y);
        let alpha = mask(bx, by, w, h) * opacity;
        if alpha <= 0. {
            return;
        }
        let r = (r * scale).max(1.);
        window.paint_quad(
            fill(
                Bounds::centered_at(at((bx, by)), size(px(2. * r), px(2. * r))),
                Rgba {
                    a: accent.a * alpha,
                    ..accent
                },
            )
            .corner_radii(px(r)),
        );
    };
    dot((-300., -300.), 4., 0.35);
    dot((300., 300.), 4., 0.35);
    for (r, start, size, turn) in AGENTS {
        dot(agent_at(r, start, turn, t), size, 0.3);
    }
}

#[cfg(test)]
mod tests {
    use super::{agent_at, mask};

    #[test]
    fn the_mask_is_quiet_in_the_middle_full_around_it_and_gone_at_the_edges() {
        let (w, h) = (1000., 400.);
        assert!((mask(500., 180., w, h) - 0.25).abs() < 1e-4);
        assert!(mask(500. + 0.35 * 600., 180., w, h) > 0.99);
        assert_eq!(mask(0., 0., w, h), 0.);
    }

    #[test]
    fn an_agent_comes_back_after_one_turn() {
        let (x0, y0) = agent_at(200., 215., 140., 0.);
        let (x1, y1) = agent_at(200., 215., 140., 140.);
        assert!((x0 - x1).abs() < 1e-3 && (y0 - y1).abs() < 1e-3);
        let (x, y) = agent_at(200., 0., 140., 35.);
        assert!(
            x.abs() < 1e-3 && (y - 200.).abs() < 1e-3,
            "a quarter turn clockwise lands below the centre"
        );
    }
}
