// Replies as markdown (spec 019 T029): pulldown-cmark parses into Zorel's own blocks (paragraphs, headings, lists,
// quotes, code, rules), drawn with GPUI text runs. Raw HTML is never rendered (shown as text), and a link opens only
// when it is http(s) or mailto (research R4.5). A finished message is parsed once (the chat caches it by message id);
// while a reply streams, only its tail is re-parsed.
// ponytail: parsing runs on the UI thread (a reply is a few KB, well under a frame); move to the background executor
// if a profile shows it. Syntax colours for code blocks (tree-sitter) come later.
use std::{ops::Range, rc::Rc};

use gpui_kit::*;
use pulldown_cmark::{CodeBlockKind, Event, HeadingLevel, Options, Parser, Tag, TagEnd};

use crate::ui::space;
use crate::{
    theme::{self, tokens},
    ui::code::code_block,
};

#[derive(Clone, Copy, Debug, PartialEq)]
pub enum Mark {
    Strong,
    Emphasis,
    Code,
    Link(usize), // index into Inline::links
}

/// A run of text with its marks and links (what one paragraph, heading or list item holds).
#[derive(Default, Debug, PartialEq)]
pub struct Inline {
    pub text: String,
    pub marks: Vec<(Range<usize>, Mark)>,
    pub links: Vec<String>,
}

#[derive(Debug, PartialEq)]
pub enum Block {
    Paragraph(Inline),
    Heading(u8, Inline),
    Item {
        depth: usize,
        ordered: Option<u64>,
        text: Inline,
    },
    Quote(Inline),
    Code {
        lang: String,
        text: String,
    },
    Rule,
}

/// Parses markdown into blocks.
pub fn parse(source: &str) -> Vec<Block> {
    let mut blocks = Vec::new();
    let mut inline = Inline::default();
    let mut open: Vec<(Mark, usize)> = Vec::new();
    let mut lists: Vec<Option<u64>> = Vec::new();
    let mut quote = 0usize;
    let mut code: Option<(String, String)> = None;
    let flush = |inline: &mut Inline| std::mem::take(inline);
    let options = Options::ENABLE_STRIKETHROUGH | Options::ENABLE_TABLES | Options::ENABLE_TASKLISTS;
    for event in Parser::new_ext(source, options) {
        match event {
            Event::Start(Tag::Strong) => open.push((Mark::Strong, inline.text.len())),
            Event::Start(Tag::Emphasis) => open.push((Mark::Emphasis, inline.text.len())),
            Event::Start(Tag::Link { dest_url, .. }) => {
                inline.links.push(dest_url.to_string());
                open.push((Mark::Link(inline.links.len() - 1), inline.text.len()));
            }
            Event::End(TagEnd::Strong | TagEnd::Emphasis | TagEnd::Link) => {
                if let Some((mark, start)) = open.pop() {
                    inline.marks.push((start..inline.text.len(), mark));
                }
            }
            Event::Code(text) => {
                let start = inline.text.len();
                inline.text.push_str(&text);
                inline.marks.push((start..inline.text.len(), Mark::Code));
            }
            Event::Text(text) => match &mut code {
                Some((_, body)) => body.push_str(&text),
                None => inline.text.push_str(&text),
            },
            // Raw HTML is shown as the text it is, never interpreted.
            Event::Html(text) | Event::InlineHtml(text) => inline.text.push_str(&text),
            Event::SoftBreak => inline.text.push(' '),
            Event::HardBreak => inline.text.push('\n'),
            Event::TaskListMarker(done) => inline.text.push_str(if done { "☑ " } else { "☐ " }),
            Event::Start(Tag::List(start)) => {
                // A nested list starts inside an item: that item's own text is complete, so it becomes its row first.
                if !lists.is_empty() && !inline.text.is_empty() {
                    let depth = lists.len() - 1;
                    let ordered = lists.last().copied().flatten();
                    blocks.push(Block::Item {
                        depth,
                        ordered,
                        text: flush(&mut inline),
                    });
                }
                lists.push(start);
            }
            Event::End(TagEnd::List(_)) => {
                lists.pop();
            }
            Event::Start(Tag::BlockQuote(_)) => quote += 1,
            Event::End(TagEnd::BlockQuote(_)) => quote = quote.saturating_sub(1),
            Event::Start(Tag::CodeBlock(kind)) => {
                let lang = match kind {
                    CodeBlockKind::Fenced(lang) => lang.to_string(),
                    CodeBlockKind::Indented => String::new(),
                };
                code = Some((lang, String::new()));
            }
            Event::End(TagEnd::CodeBlock) => {
                if let Some((lang, text)) = code.take() {
                    blocks.push(Block::Code {
                        lang,
                        text: text.trim_end_matches('\n').to_string(),
                    });
                }
            }
            Event::End(TagEnd::Heading(level)) => blocks.push(Block::Heading(heading(level), flush(&mut inline))),
            Event::End(TagEnd::Item) => {
                let depth = lists.len().saturating_sub(1);
                let ordered = lists.last().copied().flatten();
                if !inline.text.is_empty() {
                    blocks.push(Block::Item {
                        depth,
                        ordered,
                        text: flush(&mut inline),
                    });
                }
                if let Some(Some(n)) = lists.last_mut() {
                    *n += 1;
                }
            }
            Event::End(TagEnd::Paragraph) => {
                let text = flush(&mut inline);
                // A paragraph inside a list item belongs to that item.
                if !lists.is_empty() {
                    inline = text;
                } else if quote > 0 {
                    blocks.push(Block::Quote(text));
                } else {
                    blocks.push(Block::Paragraph(text));
                }
            }
            // Table cells read as text separated by a tab; rows end the line (a table view comes later).
            Event::End(TagEnd::TableCell) => inline.text.push('\t'),
            Event::End(TagEnd::TableRow | TagEnd::TableHead) => inline.text.push('\n'),
            Event::End(TagEnd::Table) => blocks.push(Block::Paragraph(flush(&mut inline))),
            Event::Rule => blocks.push(Block::Rule),
            _ => {}
        }
    }
    if !inline.text.is_empty() {
        blocks.push(Block::Paragraph(inline));
    }
    blocks
}

fn heading(level: HeadingLevel) -> u8 {
    level as u8
}

/// Only web and mail links open (research R4.5).
pub fn safe_link(url: &str) -> bool {
    let lower = url.trim().to_ascii_lowercase();
    lower.starts_with("https://") || lower.starts_with("http://") || lower.starts_with("mailto:")
}

/// The agents a text may mention (`@handle`): each drawn in its colour, a click opens it.
pub struct Mentions {
    /// (handle, lowercase, without @; agent id; its hue)
    pub people: Vec<(String, String, Rgba)>,
    pub open: OpenMention,
}

pub type OpenMention = Rc<dyn Fn(String, &mut Window, &mut App) + 'static>;

/// Draws parsed blocks; `id` keeps each block's element id stable across renders.
pub fn render(id: &str, blocks: &[Block], window: &Window) -> Div {
    render_with(id, blocks, None, window)
}

/// `render`, with the agents its text may mention.
pub fn render_with(id: &str, blocks: &[Block], mentions: Option<&Mentions>, window: &Window) -> Div {
    let p = theme::palette(window);
    let inline = |key: SharedString, text: &Inline, p: &tokens::Palette| inline(key, text, p, mentions);
    let mut column = div().flex().flex_col().gap(px(space::X2)).text_color(p.text);
    for (i, block) in blocks.iter().enumerate() {
        let key = SharedString::from(format!("{id}-{i}"));
        column = column.child(match block {
            Block::Paragraph(text) => div().min_w_0().child(inline(key, text, p)),
            Block::Heading(level, text) => div()
                .font_weight(FontWeight::SEMIBOLD)
                .text_size(px(match level {
                    1 => 18.,
                    2 => 16.,
                    _ => 14.,
                }))
                .child(inline(key, text, p)),
            Block::Item { depth, ordered, text } => div()
                .flex()
                .gap(px(space::X1_5))
                .pl(px(*depth as f32 * 16.))
                .child(div().flex_none().text_color(p.text_muted).child(match ordered {
                    Some(n) => format!("{n}."),
                    None => "•".to_string(),
                }))
                // min_w_0: a flex child is as wide as its text otherwise, and the line never wraps.
                .child(div().flex_1().min_w_0().child(inline(key, text, p))),
            Block::Quote(text) => div()
                .border_l_2()
                .border_color(p.border_strong)
                .pl(px(space::X2_5))
                .text_color(p.text_secondary)
                .child(inline(key, text, p)),
            Block::Code { text, .. } => code_block(p, text.clone()),
            Block::Rule => div().h(px(1.)).bg(p.border),
        });
    }
    column
}

// ponytail: inline code keeps the body font with a control wash (a per-run font family isn't a GPUI highlight).
fn inline(id: SharedString, text: &Inline, p: &tokens::Palette, mentions: Option<&Mentions>) -> AnyElement {
    let style = |mark: &Mark| match mark {
        Mark::Strong => HighlightStyle {
            font_weight: Some(FontWeight::SEMIBOLD),
            ..Default::default()
        },
        Mark::Emphasis => HighlightStyle {
            font_style: Some(FontStyle::Italic),
            ..Default::default()
        },
        Mark::Code => HighlightStyle {
            background_color: Some(p.bg_control.into()),
            ..Default::default()
        },
        Mark::Link(_) => HighlightStyle {
            color: Some(p.text.into()),
            underline: Some(UnderlineStyle {
                thickness: px(1.),
                color: Some(p.text_muted.into()),
                wavy: false,
            }),
            ..Default::default()
        },
    };
    let mut highlights: Vec<(Range<usize>, HighlightStyle)> =
        text.marks.iter().map(|(r, m)| (r.clone(), style(m))).collect();
    let mut links: Vec<(Range<usize>, crate::ui::selectable::Action)> = text
        .marks
        .iter()
        .filter_map(|(r, m)| match m {
            Mark::Link(i) => Some((r.clone(), text.links[*i].clone())),
            _ => None,
        })
        .filter(|(_, url)| safe_link(url))
        .map(|(r, url)| {
            let open: crate::ui::selectable::Action = Rc::new(move |_, cx| cx.open_url(&url));
            (r, open)
        })
        .collect();
    // Mentions of known agents (outside code): their colour on a soft wash, a click opens the agent.
    if let Some(m) = mentions {
        let in_code = |r: &Range<usize>| {
            text.marks
                .iter()
                .any(|(c, k)| matches!(k, Mark::Code) && c.start < r.end && r.start < c.end)
        };
        for (range, handle) in mention_ranges(&text.text) {
            let Some((_, id, hue)) = m.people.iter().find(|(h, _, _)| *h == handle) else {
                continue;
            };
            if in_code(&range) {
                continue;
            }
            highlights.retain(|(r, _)| r.end <= range.start || range.end <= r.start);
            highlights.push((
                range.clone(),
                HighlightStyle {
                    color: Some((*hue).into()),
                    font_weight: Some(FontWeight::SEMIBOLD),
                    background_color: Some(crate::ui::motion::fade(*hue, 0.14).into()),
                    ..Default::default()
                },
            ));
            let (open, id) = (m.open.clone(), id.clone());
            links.push((range, Rc::new(move |window, cx| open(id.clone(), window, cx))));
        }
        highlights.sort_by_key(|(r, _)| r.start);
    }
    // Selectable (drag, double-click, ⌘C), its marks kept; links and mentions act on a click.
    crate::ui::selectable::Selectable::new(
        id,
        text.text.clone(),
        highlights,
        crate::ui::motion::fade(p.accent, 0.35),
    )
    .links(links)
    .into_any_element()
}

/// Every `@handle` in a text (at a word's start): its byte range and the handle, lowercase.
pub fn mention_ranges(text: &str) -> Vec<(Range<usize>, String)> {
    let mut out = Vec::new();
    let mut prev: Option<char> = None;
    let mut it = text.char_indices().peekable();
    while let Some((i, c)) = it.next() {
        if c == '@' && !prev.is_some_and(|p| p.is_alphanumeric()) {
            let mut end = i + 1;
            while let Some(&(j, d)) = it.peek() {
                if d.is_alphanumeric() || d == '-' || d == '_' {
                    end = j + d.len_utf8();
                    it.next();
                } else {
                    break;
                }
            }
            let raw = text[i + 1..end].trim_end_matches('-');
            if !raw.is_empty() {
                out.push((i..i + 1 + raw.len(), raw.to_lowercase()));
            }
            prev = text[..end].chars().last();
            continue;
        }
        prev = Some(c);
    }
    out
}

#[cfg(test)]
mod tests {
    use super::{Block, Mark, parse, safe_link}; // not `*`: gpui_kit's glob brings its own `test` attribute

    #[test]
    fn blocks_marks_and_links() {
        let blocks = parse(
            "# Title\n\nSome **bold** and `code` with [a link](https://x.dev).\n\n- one\n- two\n\n```rust\nfn main() {}\n```\n",
        );
        assert!(matches!(&blocks[0], Block::Heading(1, t) if t.text == "Title"));
        let Block::Paragraph(p) = &blocks[1] else {
            panic!("{blocks:?}")
        };
        assert_eq!(p.text, "Some bold and code with a link.");
        assert_eq!(p.links, vec!["https://x.dev"]);
        assert!(p.marks.contains(&(5..9, Mark::Strong)));
        assert!(matches!(&blocks[2], Block::Item { depth: 0, ordered: None, text } if text.text == "one"));
        assert!(matches!(&blocks[4], Block::Code { lang, text } if lang == "rust" && text == "fn main() {}"));
    }

    #[test]
    fn mentions_are_found_at_word_starts() {
        let found = super::mention_ranges("Ask @Plano, then @dev-ops. mail a@b.c");
        let handles: Vec<&str> = found.iter().map(|(_, h)| h.as_str()).collect();
        assert_eq!(handles, ["plano", "dev-ops"]);
        assert_eq!(&"Ask @Plano, then @dev-ops. mail a@b.c"[found[0].0.clone()], "@Plano");
    }

    #[test]
    fn a_nested_list_keeps_its_parent_item() {
        let blocks = parse("- one\n- two\n  - nested\n- three\n");
        let items: Vec<(usize, &str)> = blocks
            .iter()
            .filter_map(|b| match b {
                Block::Item { depth, text, .. } => Some((*depth, text.text.as_str())),
                _ => None,
            })
            .collect();
        assert_eq!(items, [(0, "one"), (0, "two"), (1, "nested"), (0, "three")]);
    }

    #[test]
    fn html_is_text_and_unsafe_links_stay_shut() {
        let blocks = parse("<script>alert(1)</script> hi");
        let Block::Paragraph(p) = &blocks[0] else {
            panic!("{blocks:?}")
        };
        assert!(p.text.contains("<script>"));
        assert!(!safe_link("javascript:alert(1)"));
        assert!(!safe_link("file:///etc/passwd"));
        assert!(safe_link("https://zorel.dev") && safe_link("mailto:a@b.c"));
    }
}
