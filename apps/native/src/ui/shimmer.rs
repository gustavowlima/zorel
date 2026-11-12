// Text that is thinking (a live turn's status, "Working", what a step does now): a band of light passes over the
// words from start to end, again and again, in the text's own tone (muted, lit). Built from per-character colours on
// one shaped run, so it stays one line of text that truncates and reads to screen readers as itself.
use gpui_kit::*;

use crate::ui::{face::mix, motion};

/// One pass of the light over the text.
const PASS_MS: u64 = 1800;
/// How wide the light is, in characters.
const BAND: f32 = 6.;

pub fn shimmer(id: impl Into<ElementId>, text: impl Into<SharedString>, base: Rgba, light: Rgba) -> AnyElement {
    let text: SharedString = text.into();
    let chars: Vec<(usize, usize)> = text.char_indices().map(|(i, c)| (i, i + c.len_utf8())).collect();
    let n = chars.len() as f32;
    div()
        .truncate()
        .with_animation(id, Animation::new(motion::ms(PASS_MS)).repeat(), move |el, t| {
            // The light's centre runs from before the first character to past the last.
            let at = -BAND + t * (n + 2. * BAND);
            let highlights: Vec<(std::ops::Range<usize>, HighlightStyle)> = chars
                .iter()
                .enumerate()
                .map(|(i, (start, end))| {
                    let lit = (1. - ((i as f32 - at).abs() / BAND)).clamp(0., 1.);
                    let color = mix(light, lit, base);
                    (
                        *start..*end,
                        HighlightStyle {
                            color: Some(color.into()),
                            ..Default::default()
                        },
                    )
                })
                .collect();
            el.child(StyledText::new(text.clone()).with_highlights(highlights))
        })
        .into_any_element()
}
