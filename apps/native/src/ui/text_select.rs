// Text selection across a conversation's text (the model Zed's markdown and Zeron use): GPUI has no selection for
// plain text, and our text is many elements in a virtualized list, so continuity is rebuilt here. Every frame each
// painted text registers itself in paint order (= reading order) after `reset` clears last frame's; a press anchors
// the selection in one text, and every drag move (listened to at the window, so it keeps tracking outside the
// text) resolves the head against the registry into spans: partial in the anchor's and head's texts, whole for
// every text between, and asks for a redraw, so the wash follows the pointer. Copy joins the spans in order.
// The pure half (spans, words) is tested below; ui/selectable paints and listens.
use std::{cell::RefCell, ops::Range};

use gpui_kit::*;

/// One text's slice of the selection.
#[derive(Clone, Debug, PartialEq)]
pub struct Span {
    pub key: String,
    pub range: Range<usize>,
    /// The text's whole content (copy still works once it scrolls away).
    pub text: String,
}

#[derive(Default)]
struct Selection {
    anchor_key: String,
    anchor_ix: usize,
    dragging: bool,
    spans: Vec<Span>,
}

struct Entry {
    key: String,
    text: SharedString,
    layout: TextLayout,
}

thread_local! {
    static REGISTRY: RefCell<Vec<Entry>> = const { RefCell::new(Vec::new()) };
    static STATE: RefCell<Option<Selection>> = const { RefCell::new(None) };
}

/// A zero-size canvas painted before any text: each frame's registry holds exactly that frame's texts in order.
pub fn reset() -> impl IntoElement {
    canvas(|_, _, _| (), |_, _, _, _| REGISTRY.with(|r| r.borrow_mut().clear()))
        .absolute()
        .size_0()
}

/// A painted text joins this frame's registry.
pub fn register(key: &str, text: SharedString, layout: TextLayout) {
    REGISTRY.with(|r| {
        r.borrow_mut().push(Entry {
            key: key.to_string(),
            text,
            layout,
        })
    });
}

/// The selected byte range of the text `key`, if any.
pub fn range_of(key: &str) -> Option<Range<usize>> {
    STATE.with(|s| {
        s.borrow()
            .as_ref()?
            .spans
            .iter()
            .find(|sp| sp.key == key)
            .map(|sp| sp.range.clone())
            .filter(|r| !r.is_empty())
    })
}

/// What's selected, the texts joined by blank lines.
pub fn selected_text() -> Option<String> {
    STATE.with(|s| {
        let s = s.borrow();
        let spans = &s.as_ref()?.spans;
        let parts: Vec<&str> = spans
            .iter()
            .filter(|sp| !sp.range.is_empty())
            .map(|sp| &sp.text[sp.range.clone()])
            .collect();
        (!parts.is_empty()).then(|| parts.join("\n\n"))
    })
}

/// A press in `key` at byte `ix`: one click anchors, two select the word, three the whole text.
pub fn begin(key: &str, text: &str, ix: usize, clicks: usize) {
    let range = match clicks {
        2 => word_range(text, ix),
        n if n >= 3 => 0..text.len(),
        _ => ix..ix,
    };
    STATE.with(|s| {
        *s.borrow_mut() = Some(Selection {
            anchor_key: key.to_string(),
            anchor_ix: ix,
            dragging: true,
            spans: vec![Span {
                key: key.to_string(),
                range,
                text: text.to_string(),
            }],
        })
    });
}

/// Whether `key` anchors a drag in progress.
pub fn drags(key: &str) -> bool {
    STATE.with(|s| s.borrow().as_ref().is_some_and(|s| s.dragging && s.anchor_key == key))
}

/// Moves the drag's head to a window position; true if the selection changed (the caller redraws).
pub fn drag_to(position: Point<Pixels>) -> bool {
    REGISTRY.with(|r| {
        let reg = r.borrow();
        let Some((anchor_key, anchor_ix)) =
            STATE.with(|s| s.borrow().as_ref().map(|s| (s.anchor_key.clone(), s.anchor_ix)))
        else {
            return false;
        };
        let Some(anchor) = reg.iter().position(|e| e.key == anchor_key) else {
            return false;
        };
        // The text under the pointer, else the nearest: by line first, then sideways (table cells).
        let distance = |b: Bounds<Pixels>| {
            let dx = f32::from((b.left() - position.x).max(position.x - b.right()).max(px(0.)));
            let dy = f32::from((b.top() - position.y).max(position.y - b.bottom()).max(px(0.)));
            (dy, dx)
        };
        let Some(head) = (0..reg.len()).min_by(|a, b| {
            distance(reg[*a].layout.bounds())
                .partial_cmp(&distance(reg[*b].layout.bounds()))
                .unwrap_or(std::cmp::Ordering::Equal)
        }) else {
            return false;
        };
        let ix = match reg[head].layout.index_for_position(position) {
            Ok(ix) | Err(ix) => ix,
        };
        let texts: Vec<(&str, &str)> = reg.iter().map(|e| (e.key.as_str(), e.text.as_ref())).collect();
        let spans = resolve(&texts, (anchor, anchor_ix), (head, ix));
        STATE.with(|s| {
            let mut s = s.borrow_mut();
            let Some(sel) = s.as_mut() else { return false };
            let changed = sel.spans != spans;
            sel.spans = spans;
            changed
        })
    })
}

/// The press is over.
pub fn end() {
    STATE.with(|s| {
        if let Some(sel) = s.borrow_mut().as_mut() {
            sel.dragging = false;
        }
    });
}

/// Clears the selection (a press outside any text); true if there was one.
pub fn clear() -> bool {
    STATE.with(|s| {
        s.borrow_mut()
            .take()
            .is_some_and(|sel| sel.spans.iter().any(|sp| !sp.range.is_empty()))
    })
}

/// The spans between two (text, byte) points of `texts` (reading order), either direction.
pub fn resolve(texts: &[(&str, &str)], a: (usize, usize), b: (usize, usize)) -> Vec<Span> {
    let (start, end) = if a <= b { (a, b) } else { (b, a) };
    (start.0..=end.0.min(texts.len().saturating_sub(1)))
        .filter_map(|i| {
            let (key, text) = texts[i];
            let from = if i == start.0 { start.1 } else { 0 }.min(text.len());
            let to = if i == end.0 { end.1 } else { text.len() }.min(text.len());
            (from <= to).then(|| Span {
                key: key.to_string(),
                range: from..to,
                text: text.to_string(),
            })
        })
        .collect()
}

/// The word around byte `ix` (letters, digits, _ and -), or the single character there.
pub fn word_range(text: &str, ix: usize) -> Range<usize> {
    let word = |c: char| c.is_alphanumeric() || c == '_' || c == '-';
    let ix = ix.min(text.len());
    // On a space or punctuation: just that character.
    if let Some(c) = text[ix..].chars().next().filter(|c| !word(*c)) {
        return ix..ix + c.len_utf8();
    }
    let start = text[..ix]
        .char_indices()
        .rev()
        .take_while(|(_, c)| word(*c))
        .last()
        .map_or(ix, |(i, _)| i);
    let end = text[ix..]
        .char_indices()
        .take_while(|(_, c)| word(*c))
        .last()
        .map_or(ix, |(i, c)| ix + i + c.len_utf8());
    if start == end {
        let next = text[ix..].chars().next().map_or(0, char::len_utf8);
        return ix..ix + next;
    }
    start..end
}

#[cfg(test)]
mod tests {
    use super::{resolve, word_range};

    #[test]
    fn spans_cover_the_texts_between_whole() {
        let texts = [("a", "hello world"), ("b", "middle"), ("c", "the end")];
        let spans = resolve(&texts, (0, 6), (2, 3));
        let got: Vec<(&str, std::ops::Range<usize>)> =
            spans.iter().map(|s| (s.key.as_str(), s.range.clone())).collect();
        assert_eq!(got, [("a", 6..11), ("b", 0..6), ("c", 0..3)]);
        // Backwards gives the same.
        assert_eq!(resolve(&texts, (2, 3), (0, 6)), spans);
    }

    #[test]
    fn a_double_click_takes_the_word() {
        assert_eq!(word_range("say hello-there now", 6), 4..15);
        assert_eq!(word_range("a, b", 1), 1..2);
    }
}
