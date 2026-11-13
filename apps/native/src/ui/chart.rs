// A small area chart (Settings › Processes' last 24 hours): points as fractions of the box (x 0..1 left to right, y 0..1
// bottom to top), drawn as a smooth line over a soft fill in one colour. Decoration plus a reading: no hit testing.
use gpui_kit::*;

/// The chart, filling its box; `points` sorted by x. Fewer than two points draw nothing.
pub fn area(points: Vec<(f32, f32)>, color: Rgba) -> impl IntoElement {
    canvas(
        |_, _, _| (),
        move |bounds, _, window, _| paint(bounds, &points, color, window),
    )
    .size_full()
}

fn paint(bounds: Bounds<Pixels>, points: &[(f32, f32)], color: Rgba, window: &mut Window) {
    if points.len() < 2 {
        return;
    }
    let (w, h) = (f32::from(bounds.size.width), f32::from(bounds.size.height));
    // A little room top and bottom so the line's width never clips.
    let at = |(x, y): (f32, f32)| {
        point(
            bounds.origin.x + px(x * w),
            bounds.origin.y + px(2. + (1. - y.clamp(0., 1.)) * (h - 4.)),
        )
    };
    // Smooth: each segment curves through the midpoint between samples.
    let trace = |path: &mut PathBuilder| {
        for pair in points.windows(2) {
            let (a, b) = (at(pair[0]), at(pair[1]));
            let mid = point((a.x + b.x) / 2., (a.y + b.y) / 2.);
            path.curve_to(mid, a);
        }
        path.line_to(at(points[points.len() - 1]));
    };
    let base = bounds.origin.y + bounds.size.height;
    let mut fill = PathBuilder::fill();
    fill.move_to(point(at(points[0]).x, base));
    fill.line_to(at(points[0]));
    trace(&mut fill);
    fill.line_to(point(at(points[points.len() - 1]).x, base));
    fill.close();
    if let Ok(path) = fill.build() {
        window.paint_path(path, Rgba { a: 0.14, ..color });
    }
    let mut line = PathBuilder::stroke(px(1.75));
    line.move_to(at(points[0]));
    trace(&mut line);
    if let Ok(path) = line.build() {
        window.paint_path(path, color);
    }
}
