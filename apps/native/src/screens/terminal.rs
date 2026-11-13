// One shell (apps/web/src/features/shell.tsx): a session that lives on the engine (net/terminal), emulated here by
// alacritty_terminal (the grid, escapes, scrollback 5000, selection) and drawn on a canvas in Menlo 12: each line's
// text shaped with its colour runs, backgrounds and the selection under it, the cursor over it. Keys go up as input
// (arrows in the app-cursor mode when asked, Ctrl+letter, Alt as Esc), Cmd+V pastes (bracketed when the shell wants
// it), Cmd+C copies the selection, the wheel scrolls the history; the size follows the box. Selected text can go to
// the chat ("Add to chat"). Closing the tab only detaches: the session goes on until killed.
use std::{cell::RefCell, rc::Rc};

use alacritty_terminal::{
    event::{Event as TermEvent, EventListener},
    grid::Scroll,
    index::{Column, Line, Point as GridPoint, Side},
    selection::{Selection, SelectionType},
    term::{Config, Term, TermMode, cell::Flags, test::TermSize},
    vte::ansi::{Color, NamedColor, Processor, Rgb},
};
use gpui_kit::{prelude::FluentBuilder, *};
use rust_i18n::t;
use tokio::sync::mpsc;

use crate::{
    net::{
        http::Http,
        terminal::{self, Down, Up},
    },
    theme::{self, tokens::Palette},
    ui::{
        button::{Button, Size, Variant},
        code::MONO,
        space,
    },
};

const FONT_SIZE: f32 = 12.;
const LINE_H: f32 = 16.;
const SCROLLBACK: usize = 5000;

/// Answers the shell asked for (cursor position, device attributes), sent back up after each chunk.
#[derive(Clone, Default)]
struct Listener(Rc<RefCell<Vec<String>>>);

impl EventListener for Listener {
    fn send_event(&self, event: TermEvent) {
        if let TermEvent::PtyWrite(text) = event {
            self.0.borrow_mut().push(text);
        }
    }
}

pub type OnText = Rc<dyn Fn(String, &mut Window, &mut App) + 'static>;

pub struct Shell {
    term: Term<Listener>,
    parser: Processor,
    answers: Listener,
    up: mpsc::UnboundedSender<Up>,
    /// Its session and number in the chat ("Shell 2"), once attached; ended: no input any more.
    pub session: Option<String>,
    pub n: u32,
    pub ended: bool,
    size: (u16, u16),
    /// Where the grid was last painted (for the mouse), and the cell's size.
    origin: Rc<RefCell<Point<Pixels>>>,
    cell_w: f32,
    focus: FocusHandle,
    on_add: Option<OnText>,
    _reader: Task<()>,
}

impl Shell {
    /// A new shell (or `session` again) in `chat`.
    pub fn new(
        http: Http,
        chat: String,
        session: Option<String>,
        on_add: Option<OnText>,
        cx: &mut Context<Self>,
    ) -> Self {
        let size = (80u16, 24u16);
        let answers = Listener::default();
        let config = Config {
            scrolling_history: SCROLLBACK,
            ..Config::default()
        };
        let term = Term::new(
            config,
            &TermSize::new(size.0 as usize, size.1 as usize),
            answers.clone(),
        );
        let (up, mut down) = terminal::connect(http, chat, session.clone(), size);
        let reader = cx.spawn(async move |this, cx| {
            while let Some(event) = down.recv().await {
                let Ok(()) = this.update(cx, |this, cx| {
                    match event {
                        Down::Attached { id, n } => {
                            this.session = Some(id);
                            this.n = n;
                            // The replay that follows is the whole recent screen.
                            this.term = Term::new(
                                Config {
                                    scrolling_history: SCROLLBACK,
                                    ..Config::default()
                                },
                                &TermSize::new(this.size.0 as usize, this.size.1 as usize),
                                this.answers.clone(),
                            );
                        }
                        Down::Output(bytes) => {
                            this.parser.advance(&mut this.term, &bytes);
                            for answer in this.answers.0.borrow_mut().drain(..) {
                                let _ = this.up.send(Up::Input(answer));
                            }
                        }
                        Down::Ended => this.ended = true,
                    }
                    cx.notify();
                }) else {
                    break;
                };
            }
        });
        Self {
            term,
            parser: Processor::new(),
            answers,
            up,
            session,
            n: 0,
            ended: false,
            size,
            origin: Rc::default(),
            cell_w: 7.2,
            focus: cx.focus_handle(),
            on_add,
            _reader: reader,
        }
    }

    pub fn focus(&self, window: &mut Window, cx: &mut App) {
        self.focus.focus(window, cx);
    }

    /// Ends the session on the engine.
    pub fn kill(&self) {
        let _ = self.up.send(Up::Kill);
    }

    fn send(&mut self, text: String) {
        if self.ended || text.is_empty() {
            return;
        }
        // Typing brings the view back to the bottom.
        self.term.scroll_display(Scroll::Bottom);
        self.term.selection = None;
        let _ = self.up.send(Up::Input(text));
    }

    /// Follows the box: a new size resizes the grid and tells the shell.
    fn fit(&mut self, cols: u16, rows: u16) {
        if (cols, rows) == self.size || cols < 2 || rows < 2 {
            return;
        }
        self.size = (cols, rows);
        self.term.resize(TermSize::new(cols as usize, rows as usize));
        let _ = self.up.send(Up::Resize(cols, rows));
    }

    /// The bytes a key sends (None: not the shell's).
    fn bytes_of(&self, k: &Keystroke) -> Option<String> {
        let app = self.term.mode().contains(TermMode::APP_CURSOR);
        let arrow = |c: char| Some(if app { format!("\x1bO{c}") } else { format!("\x1b[{c}") });
        let m = &k.modifiers;
        if m.platform {
            return None;
        }
        let named = match k.key.as_str() {
            "enter" => Some("\r".to_string()),
            "backspace" => Some(if m.alt { "\x1b\x7f".into() } else { "\x7f".into() }),
            "tab" => Some(if m.shift { "\x1b[Z".into() } else { "\t".into() }),
            "escape" => Some("\x1b".into()),
            "up" => arrow('A'),
            "down" => arrow('B'),
            "right" => arrow('C'),
            "left" => arrow('D'),
            "home" => Some("\x1b[H".into()),
            "end" => Some("\x1b[F".into()),
            "pageup" => Some("\x1b[5~".into()),
            "pagedown" => Some("\x1b[6~".into()),
            "delete" => Some("\x1b[3~".into()),
            _ => None,
        };
        if named.is_some() {
            return named;
        }
        if m.control && k.key.chars().count() == 1 {
            let c = k.key.chars().next()?.to_ascii_lowercase();
            if c.is_ascii_lowercase() {
                return Some(((c as u8 - b'a' + 1) as char).to_string());
            }
        }
        let text = k
            .key_char
            .clone()
            .or_else(|| (k.key == "space").then(|| " ".to_string()))?;
        Some(if m.alt { format!("\x1b{text}") } else { text })
    }

    fn paste(&mut self, cx: &mut Context<Self>) {
        let Some(text) = cx.read_from_clipboard().and_then(|c| c.text()) else {
            return;
        };
        let text = if self.term.mode().contains(TermMode::BRACKETED_PASTE) {
            format!("\x1b[200~{}\x1b[201~", text.replace('\x1b', ""))
        } else {
            text.replace("\r\n", "\r").replace('\n', "\r")
        };
        self.send(text);
    }

    /// The grid point under a window position.
    fn point_at(&self, at: Point<Pixels>) -> GridPoint {
        let origin = *self.origin.borrow();
        let col = ((f32::from(at.x - origin.x)) / self.cell_w).floor().max(0.) as usize;
        let row = ((f32::from(at.y - origin.y)) / LINE_H).floor().max(0.) as i32;
        let offset = self.term.grid().display_offset() as i32;
        GridPoint::new(
            Line(row.min(self.size.1 as i32 - 1) - offset),
            Column(col.min(self.size.0 as usize - 1)),
        )
    }

    fn selected(&self) -> Option<String> {
        self.term.selection_to_string().filter(|s| !s.trim().is_empty())
    }
}

/// The 16 ANSI colours, tuned to sit on Zorel's code surface.
const ANSI: [u32; 16] = [
    0x1d1f24, 0xe06c75, 0x98c379, 0xe5c07b, 0x61afef, 0xc678dd, 0x56b6c2, 0xabb2bf, 0x5c6370, 0xff7b86, 0xb5e890,
    0xf0d58a, 0x7cc4ff, 0xd99cf0, 0x6fd2de, 0xe6e6e6,
];

fn rgb(c: Rgb) -> Hsla {
    Rgba {
        r: c.r as f32 / 255.,
        g: c.g as f32 / 255.,
        b: c.b as f32 / 255.,
        a: 1.,
    }
    .into()
}

fn hex(v: u32) -> Hsla {
    rgb(Rgb {
        r: (v >> 16) as u8,
        g: (v >> 8) as u8,
        b: v as u8,
    })
}

/// A cell colour in the theme: the default foreground and background are Zorel's; the rest the ANSI table, the 6×6×6
/// cube and the grey ramp.
fn color_of(c: Color, p: &Palette, fg: bool) -> Option<Hsla> {
    match c {
        Color::Spec(rgb_) => Some(rgb(rgb_)),
        Color::Indexed(i) => Some(match i {
            0..=15 => hex(ANSI[i as usize]),
            16..=231 => {
                let i = i - 16;
                let level = |v: u8| if v == 0 { 0 } else { 55 + v * 40 };
                rgb(Rgb {
                    r: level(i / 36),
                    g: level((i / 6) % 6),
                    b: level(i % 6),
                })
            }
            _ => {
                let v = 8 + (i - 232) * 10;
                rgb(Rgb { r: v, g: v, b: v })
            }
        }),
        Color::Named(n) => match n {
            NamedColor::Foreground | NamedColor::BrightForeground => Some(p.text_secondary.into()),
            // The default background is the surface itself: nothing to paint.
            NamedColor::Background => None,
            NamedColor::Cursor => Some(p.text.into()),
            n if (n as usize) < 16 => Some(hex(ANSI[n as usize])),
            n if (n as usize) >= NamedColor::DimBlack as usize && (n as usize) < NamedColor::DimBlack as usize + 8 => {
                Some(hex(ANSI[n as usize - NamedColor::DimBlack as usize]).opacity(0.7))
            }
            _ => fg.then_some(p.text_secondary.into()),
        },
    }
}

/// One painted line: its text with colour runs, the backgrounds under it.
struct Row {
    text: String,
    runs: Vec<(usize, Hsla, bool)>,
    backs: Vec<(usize, usize, Hsla)>,
}

impl Render for Shell {
    fn render(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let p = theme::palette(window);
        let font_id = window.text_system().resolve_font(&font(MONO));
        self.cell_w = window
            .text_system()
            .advance(font_id, px(FONT_SIZE), 'm')
            .map(|s| f32::from(s.width))
            .unwrap_or(7.2);
        // A snapshot of what shows, for the canvas to paint.
        let content = self.term.renderable_content();
        let offset = content.display_offset as i32;
        let rows_n = self.size.1 as usize;
        let mut rows: Vec<Row> = (0..rows_n)
            .map(|_| Row {
                text: String::new(),
                runs: Vec::new(),
                backs: Vec::new(),
            })
            .collect();
        for indexed in content.display_iter {
            let row = (indexed.point.line.0 + offset) as usize;
            let Some(r) = rows.get_mut(row) else { continue };
            let cell = indexed.cell;
            if cell.flags.contains(Flags::WIDE_CHAR_SPACER) {
                continue;
            }
            let (mut fg, mut bg) = (cell.fg, cell.bg);
            if cell.flags.contains(Flags::INVERSE) {
                std::mem::swap(&mut fg, &mut bg);
            }
            let fg = color_of(fg, p, true).unwrap_or(p.text_secondary.into());
            let col = indexed.point.column.0;
            if let Some(bg) = color_of(bg, p, false) {
                r.backs
                    .push((col, if cell.flags.contains(Flags::WIDE_CHAR) { 2 } else { 1 }, bg));
            }
            let ch = if cell.flags.contains(Flags::HIDDEN) {
                ' '
            } else {
                cell.c
            };
            let start = r.text.len();
            r.text.push(ch);
            let bold = cell.flags.contains(Flags::BOLD);
            match r.runs.last_mut() {
                Some((len, color, b)) if *color == fg && *b == bold => *len += r.text.len() - start,
                _ => r.runs.push((r.text.len() - start, fg, bold)),
            }
        }
        let selection: Vec<(usize, usize, usize)> = content
            .selection
            .map(|s| {
                (0..rows_n)
                    .filter_map(|row| {
                        let line = row as i32 - offset;
                        let (start, end) = (s.start, s.end);
                        if line < start.line.0 || line > end.line.0 {
                            return None;
                        }
                        let from = if line == start.line.0 { start.column.0 } else { 0 };
                        let to = if line == end.line.0 {
                            end.column.0 + 1
                        } else {
                            self.size.0 as usize
                        };
                        Some((row, from, to))
                    })
                    .collect()
            })
            .unwrap_or_default();
        let cursor = (offset == 0 && !self.ended && self.focus.is_focused(window))
            .then_some((content.cursor.point.line.0 as usize, content.cursor.point.column.0));
        let (cell_w, origin, entity) = (self.cell_w, self.origin.clone(), cx.entity().downgrade());
        let (cursor_color, select_color) = (p.text, crate::ui::motion::fade(p.accent, 0.35));
        let grid = canvas(
            move |bounds, _, cx| {
                // Fit the grid to the box (deferred: the shell updates outside this paint).
                let cols = ((f32::from(bounds.size.width)) / cell_w).floor() as u16;
                let lines = ((f32::from(bounds.size.height)) / LINE_H).floor() as u16;
                let entity = entity.clone();
                cx.defer(move |cx| {
                    let _ = entity.update(cx, |this, cx| {
                        let before = this.size;
                        this.fit(cols, lines);
                        if this.size != before {
                            cx.notify();
                        }
                    });
                });
                bounds
            },
            move |_, bounds, window, cx| {
                *origin.borrow_mut() = bounds.origin;
                let at = |row: usize, col: usize| {
                    point(
                        bounds.origin.x + px(col as f32 * cell_w),
                        bounds.origin.y + px(row as f32 * LINE_H),
                    )
                };
                for (i, r) in rows.iter().enumerate() {
                    for (col, span, bg) in &r.backs {
                        window.paint_quad(fill(
                            Bounds::new(at(i, *col), size(px(cell_w * *span as f32), px(LINE_H))),
                            *bg,
                        ));
                    }
                }
                for (row, from, to) in &selection {
                    window.paint_quad(fill(
                        Bounds::new(at(*row, *from), size(px(cell_w * (to - from) as f32), px(LINE_H))),
                        select_color,
                    ));
                }
                if let Some((row, col)) = cursor {
                    window.paint_quad(fill(
                        Bounds::new(at(row, col), size(px(cell_w), px(LINE_H))),
                        Hsla::from(cursor_color).opacity(0.7),
                    ));
                }
                let base = font(MONO);
                for (i, r) in rows.iter().enumerate() {
                    if r.text.trim().is_empty() {
                        continue;
                    }
                    let runs: Vec<TextRun> = r
                        .runs
                        .iter()
                        .map(|(len, color, bold)| TextRun {
                            len: *len,
                            font: if *bold { base.clone().bold() } else { base.clone() },
                            color: *color,
                            background_color: None,
                            underline: None,
                            strikethrough: None,
                        })
                        .collect();
                    let line =
                        window
                            .text_system()
                            .shape_line(r.text.clone().into(), px(FONT_SIZE), &runs, Some(px(cell_w)));
                    let _ = line.paint(at(i, 0), px(LINE_H), TextAlign::Left, None, window, cx);
                }
            },
        )
        .size_full();
        let selected = self.selected();
        let on_add = self.on_add.clone();
        div()
            .id("shell")
            .track_focus(&self.focus)
            .key_context("Terminal")
            .relative()
            .size_full()
            .bg(p.bg_code)
            .px(px(space::X2))
            .py(px(space::X1_5))
            .cursor(CursorStyle::IBeam)
            .on_key_down(cx.listener(|this, e: &KeyDownEvent, _, cx| {
                let k = &e.keystroke;
                if k.modifiers.platform && k.key == "v" {
                    this.paste(cx);
                } else if let Some(bytes) = this.bytes_of(k) {
                    this.send(bytes);
                } else {
                    return;
                }
                cx.stop_propagation();
                cx.notify();
            }))
            // Cmd+C here copies the shell's selection (before the window's Copy, which copies the chat's).
            .on_action(cx.listener(|this, _: &gpui_kit::base::input::Copy, _, cx| {
                if let Some(text) = this.selected() {
                    cx.write_to_clipboard(ClipboardItem::new_string(text));
                }
            }))
            .on_mouse_down(
                MouseButton::Left,
                cx.listener(|this, e: &MouseDownEvent, window, cx| {
                    this.focus.focus(window, cx);
                    let at = this.point_at(e.position);
                    let ty = match e.click_count {
                        2 => SelectionType::Semantic,
                        n if n >= 3 => SelectionType::Lines,
                        _ => SelectionType::Simple,
                    };
                    this.term.selection = Some(Selection::new(ty, at, Side::Left));
                    cx.notify();
                }),
            )
            .on_mouse_move(cx.listener(|this, e: &MouseMoveEvent, _, cx| {
                if e.dragging() && this.term.selection.is_some() {
                    let at = this.point_at(e.position);
                    if let Some(sel) = &mut this.term.selection {
                        sel.update(at, Side::Right);
                    }
                    cx.notify();
                }
            }))
            .on_scroll(cx.listener(|this, e: &ScrollEvent, _, cx| {
                let dy = f32::from(e.delta.pixel_delta(px(LINE_H)).y);
                let lines = (dy / LINE_H).round() as i32;
                if lines != 0 {
                    this.term.scroll_display(Scroll::Delta(lines));
                    cx.notify();
                }
            }))
            .child(grid)
            .when_some(selected.zip(on_add), |d, (text, add)| {
                d.child(
                    div().absolute().top(px(space::X2)).right(px(space::X3)).child(
                        Button::new("shell-add", t!("workspace.addToChat").into_owned())
                            .icon(gpui_kit::assets::IconName::MessageCircle)
                            .variant(Variant::Secondary)
                            .size(Size::Sm)
                            .on_click(move |_, window, cx| add(format!("```\n{}\n```", text.trim_end()), window, cx)),
                    ),
                )
            })
            .when(self.ended, |d| {
                d.child(
                    div()
                        .absolute()
                        .bottom(px(space::X2))
                        .left(px(space::X3))
                        .text_xs()
                        .text_color(p.text_dim)
                        .child(t!("workspace.shellEnded").into_owned()),
                )
            })
    }
}

impl Focusable for Shell {
    fn focus_handle(&self, _: &App) -> FocusHandle {
        self.focus.clone()
    }
}
