// One file's diff, unified (the web's DiffView, without its syntax colours): each hunk under a quiet separator, every
// line with its old and new numbers, added lines on the success tint, removed on the danger tint, context plain; long
// lines wrap. The patch is parsed once by the caller (`parse`), so drawing is cheap.
use gpui_kit::{prelude::FluentBuilder, *};

use crate::{
    theme::{self, tokens},
    ui::{code::MONO, space},
};

#[derive(Clone, Copy, Debug, PartialEq)]
pub enum Kind {
    Context,
    Added,
    Removed,
    /// A hunk's "@@ -a,b +c,d @@" line.
    Hunk,
}

#[derive(Clone, Debug, PartialEq)]
pub struct Line {
    pub kind: Kind,
    pub old: Option<u32>,
    pub new: Option<u32>,
    pub text: String,
}

/// A unified patch's lines with their numbers (file headers dropped; "\ No newline" notes dropped).
pub fn parse(patch: &str) -> Vec<Line> {
    let (mut old, mut new) = (0u32, 0u32);
    let mut out = Vec::new();
    let mut in_hunk = false;
    for raw in patch.lines() {
        if let Some(rest) = raw.strip_prefix("@@") {
            // "@@ -12,7 +12,9 @@ fn x()": where each side starts.
            let mut parts = rest.split_whitespace();
            let start = |s: Option<&str>, sign: char| {
                s.and_then(|s| s.strip_prefix(sign))
                    .and_then(|s| s.split(',').next())
                    .and_then(|n| n.parse::<u32>().ok())
                    .unwrap_or(1)
            };
            old = start(parts.next(), '-');
            new = start(parts.next(), '+');
            in_hunk = true;
            out.push(Line {
                kind: Kind::Hunk,
                old: None,
                new: None,
                text: raw.to_string(),
            });
            continue;
        }
        if !in_hunk || raw.starts_with('\\') {
            continue; // the file headers before the first hunk, and "\ No newline at end of file"
        }
        let (kind, text) = match raw.chars().next() {
            Some('+') => (Kind::Added, &raw[1..]),
            Some('-') => (Kind::Removed, &raw[1..]),
            Some(' ') => (Kind::Context, &raw[1..]),
            _ => (Kind::Context, raw),
        };
        let (o, n) = match kind {
            Kind::Added => (None, Some(new)),
            Kind::Removed => (Some(old), None),
            _ => (Some(old), Some(new)),
        };
        if kind != Kind::Added {
            old += 1;
        }
        if kind != Kind::Removed {
            new += 1;
        }
        out.push(Line {
            kind,
            old: o,
            new: n,
            text: text.to_string(),
        });
    }
    out
}

/// Draws parsed lines.
pub fn render(lines: &[Line], window: &Window) -> AnyElement {
    let p = theme::palette(window);
    let number = |n: Option<u32>| {
        div()
            .flex_none()
            .w(px(36.))
            .pr(px(space::X1_5))
            .text_right()
            .text_color(p.text_dim)
            .child(n.map(|n| n.to_string()).unwrap_or_default())
    };
    div()
        .flex()
        .flex_col()
        .py(px(space::X1))
        .bg(p.bg_code)
        .font_family(MONO)
        .text_size(px(12.))
        .line_height(px(18.))
        .children(lines.iter().map(|l| {
            match l.kind {
                Kind::Hunk => div()
                    .px(px(space::X3))
                    .py(px(space::X0_5))
                    .my(px(space::X0_5))
                    .bg(p.accent_faint)
                    .text_color(p.text_muted)
                    .truncate()
                    .child(l.text.clone())
                    .into_any_element(),
                kind => {
                    let (bg, mark, color) = match kind {
                        Kind::Added => (Some(p.success_faint), "+", p.success),
                        Kind::Removed => (Some(p.danger_soft), "−", p.danger),
                        _ => (None, " ", p.text_dim),
                    };
                    div()
                        .flex()
                        .items_start()
                        .map(|d| match bg {
                            Some(bg) => d.bg(bg),
                            None => d,
                        })
                        .child(number(l.old))
                        .child(number(l.new))
                        .child(div().flex_none().w(px(14.)).text_color(color).child(mark))
                        .child(
                            div()
                                .flex_1()
                                .min_w_0()
                                .pr(px(space::X3))
                                .text_color(p.text_secondary)
                                .child(l.text.clone()),
                        )
                        .into_any_element()
                }
            }
        }))
        .rounded(px(tokens::RADIUS_CONTROL))
        .into_any_element()
}

#[cfg(test)]
mod tests {
    use super::{Kind, parse};

    #[test]
    fn a_patch_reads_as_numbered_lines() {
        let lines = parse(
            "--- a/x\n+++ b/x\n@@ -3,3 +3,4 @@ fn a()\n keep\n-old\n+new\n+more\n keep2\n\\ No newline at end of file\n",
        );
        let got: Vec<(Kind, Option<u32>, Option<u32>, &str)> =
            lines.iter().map(|l| (l.kind, l.old, l.new, l.text.as_str())).collect();
        assert_eq!(
            got[1..],
            [
                (Kind::Context, Some(3), Some(3), "keep"),
                (Kind::Removed, Some(4), None, "old"),
                (Kind::Added, None, Some(4), "new"),
                (Kind::Added, None, Some(5), "more"),
                (Kind::Context, Some(5), Some(6), "keep2"),
            ]
        );
        assert_eq!(got[0].0, Kind::Hunk);
    }
}
