// A small progress ring (the context meter's): a track circle and, over it, the arc of `ratio` from 12 o'clock,
// clockwise, with round-ish ends drawn as short segments. Pure drawing on a canvas of `size`.
use gpui_kit::*;

const SEGMENTS: usize = 48;

pub fn ring(ratio: f32, size: f32, stroke: f32, color: Rgba, track: Rgba) -> impl IntoElement {
    let ratio = ratio.clamp(0., 1.);
    canvas(
        |_, _, _| (),
        move |bounds, _, window, _| {
            let r = (size - stroke) / 2.;
            let center = point(bounds.origin.x + px(size / 2.), bounds.origin.y + px(size / 2.));
            let at = |turn: f32| {
                // From the top, clockwise.
                let a = turn * std::f32::consts::TAU - std::f32::consts::FRAC_PI_2;
                point(center.x + px(r * a.cos()), center.y + px(r * a.sin()))
            };
            let arc = |from: f32, to: f32| {
                let steps = ((to - from) * SEGMENTS as f32).ceil().max(1.) as usize;
                let mut path = PathBuilder::stroke(px(stroke));
                path.move_to(at(from));
                for i in 1..=steps {
                    path.line_to(at(from + (to - from) * i as f32 / steps as f32));
                }
                path.build().ok()
            };
            if let Some(p) = arc(0., 1.) {
                window.paint_path(p, track);
            }
            // A sliver shows even near zero, so a started chat doesn't read as empty.
            let shown = if ratio > 0. { ratio.max(0.02) } else { 0. };
            if shown > 0.
                && let Some(p) = arc(0., shown)
            {
                window.paint_path(p, color);
            }
        },
    )
    .size(px(size))
}
