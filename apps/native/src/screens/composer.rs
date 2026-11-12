// The message box (Home and the chat; prototype Inicio/Chat, apps/web/src/features/composer.tsx): a raised card with
// the text (Enter sends, Shift+Enter breaks the line, grows to 8 lines), files to attach (+, up to 10, 20 MB each),
// a tools slot (the model) and the round send button. It only collects: whoever owns it decides what sending means
// (create the chat, send, or queue) through `on_submit`, and can hand the text back when sending failed.
// Typing a trigger opens a menu above the box with what the screen offers (`set_sources`): # and @ call an agent or a
// team (a chip in its hue, "@handle" in the text), $ a skill, / at a line's start a command (Zorel's run here, the
// engine's are written in). ↑/↓ move, Enter or Tab pick, Esc closes; the list enters with motion.
// ponytail: @ project files, paste and drop of files come with the side panel's Files.
use std::{path::PathBuf, rc::Rc};

use gpui_kit::{
    assets::IconName,
    base::input::{InlineToken, InlineTokenContext, InputEvent, Textarea, TextareaState},
    prelude::FluentBuilder,
    *,
};
use rust_i18n::t;

use crate::{
    theme::{self, tokens},
    ui::{
        button::{Button, Size, Variant},
        face::{self, AgentFace},
        icon::{self, icon},
        layout, motion, space,
    },
};

pub const MAX_FILES: usize = 10;
pub const MAX_FILE_BYTES: u64 = 20 * 1024 * 1024;
/// How many options a menu lists (the web's).
const MAX_OPTIONS: usize = 8;

/// What the person sends: the text and the files chosen.
pub struct Draft {
    pub text: String,
    pub files: Vec<PathBuf>,
}

pub type OnSubmit = Rc<dyn Fn(Draft, &mut Window, &mut App) + 'static>;

/// Renders the tools slot (the model picker) each frame.
pub type Tools = Rc<dyn Fn(&mut Window, &mut App) -> AnyElement>;

/// What opens a menu.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Trigger {
    /// `#`: call an agent or a team (the chip says "@handle", as "@" does).
    Lead,
    /// `@`: mention an agent or a team.
    Mention,
    /// `$`: a skill.
    Skill,
    /// `/` at a line's start: a command.
    Command,
}

impl Trigger {
    fn of(c: char) -> Option<Self> {
        match c {
            '#' => Some(Self::Lead),
            '@' => Some(Self::Mention),
            '$' => Some(Self::Skill),
            '/' => Some(Self::Command),
            _ => None,
        }
    }
}

/// What an option shows before its name.
#[derive(Clone)]
pub enum Mark {
    Face(usize),
    Icon(IconName),
}

/// One option of a menu: its handle (what the text carries), name, a line beside it, and an action for Zorel's own
/// commands (run here instead of written).
#[derive(Clone)]
pub struct MenuOption {
    pub id: String,
    pub label: String,
    pub hint: Option<String>,
    pub mark: Mark,
    pub run: Option<Run>,
}

/// Zorel's own command, run where it is picked.
pub type Run = Rc<dyn Fn(&mut Window, &mut App) + 'static>;

/// What the screen offers for a trigger.
pub type Sources = Rc<dyn Fn(Trigger, &App) -> Vec<MenuOption> + 'static>;

/// The menu open now: its trigger, where it began in the text (bytes), the options and the selected one.
struct Menu {
    trigger: Trigger,
    start: usize,
    options: Vec<MenuOption>,
    selected: usize,
}

/// The trigger the cursor is in: the run of non-space characters before it starts with #, @ or $ (after a space or at
/// the start), or with / at the start of a line. Returns the trigger, where it starts and what's typed after it.
pub fn trigger_at(text: &str, cursor: usize) -> Option<(Trigger, usize, &str)> {
    let before = text.get(..cursor)?;
    let start = before
        .char_indices()
        .rev()
        .find(|(_, c)| c.is_whitespace())
        .map_or(0, |(i, c)| i + c.len_utf8());
    let word = &before[start..];
    let first = word.chars().next()?;
    let trigger = Trigger::of(first)?;
    if trigger == Trigger::Command && start > 0 && !before[..start].ends_with('\n') {
        return None;
    }
    Some((trigger, start, &word[first.len_utf8()..]))
}

/// The options that match what's typed, best first (the handle starts with it, then a word of the name, then anywhere).
pub fn rank(options: Vec<MenuOption>, query: &str) -> Vec<MenuOption> {
    let q = query.to_lowercase();
    let score = |o: &MenuOption| {
        let id = o.id.to_lowercase();
        let words: Vec<String> = o.label.split([' ', '/']).map(str::to_lowercase).collect();
        if id.starts_with(&q) {
            0
        } else if words.iter().any(|w| w.starts_with(&q)) {
            1
        } else if id.contains(&q) || o.label.to_lowercase().contains(&q) {
            2
        } else {
            3
        }
    };
    let mut scored: Vec<(u8, MenuOption)> = options
        .into_iter()
        .map(|o| (score(&o), o))
        .filter(|(s, _)| *s < 3)
        .collect();
    scored.sort_by_key(|(s, _)| *s);
    scored.into_iter().map(|(_, o)| o).take(MAX_OPTIONS).collect()
}

pub struct Composer {
    text: Entity<TextareaState>,
    files: Vec<PathBuf>,
    error: Option<String>,
    on_submit: OnSubmit,
    /// Beside the send button (the model picker).
    tools: Option<Tools>,
    sources: Option<Sources>,
    menu: Option<Menu>,
    large: bool,
    _subscription: Subscription,
}

impl Composer {
    pub fn new(
        placeholder: String,
        large: bool,
        on_submit: OnSubmit,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> Self {
        let text = cx.new(|cx| {
            let mut state = TextareaState::new(window, cx).placeholder(placeholder);
            state.set_auto_grow(if large { 2 } else { 1 }, 8, cx);
            state
        });
        let sub = cx.subscribe_in(&text, window, |this, _, event: &InputEvent, window, cx| match event {
            InputEvent::PressEnter { shift: false, .. } => {
                if this.menu.is_some() {
                    this.pick(None, window, cx);
                } else {
                    this.submit(window, cx);
                }
            }
            InputEvent::Change => this.follow(cx),
            InputEvent::Blur => {
                this.menu = None;
                cx.notify();
            }
            _ => {}
        });
        Self {
            text,
            files: Vec::new(),
            error: None,
            on_submit,
            tools: None,
            sources: None,
            menu: None,
            large,
            _subscription: sub,
        }
    }

    pub fn set_tools(&mut self, tools: Tools) {
        self.tools = Some(tools);
    }

    /// What the menus offer here.
    pub fn set_sources(&mut self, sources: Sources) {
        self.sources = Some(sources);
    }

    /// Focus the text (Home autofocuses it).
    pub fn focus(&self, window: &mut Window, cx: &mut App) {
        self.text.update(cx, |t, cx| t.focus(window, cx));
    }

    /// Sending failed: the text comes back and the reason shows under the box.
    pub fn restore(&mut self, text: String, error: String, window: &mut Window, cx: &mut Context<Self>) {
        self.text.update(cx, |t, cx| t.set_value(text, window, cx));
        self.error = Some(error);
        cx.notify();
    }

    /// The text changed: open, narrow or close the menu for the trigger under the cursor.
    fn follow(&mut self, cx: &mut Context<Self>) {
        let state = self.text.read(cx);
        let (value, cursor) = (state.value().to_string(), state.cursor());
        let found = self
            .sources
            .clone()
            .zip(trigger_at(&value, cursor).map(|(t, s, q)| (t, s, q.to_string())));
        self.menu = found.and_then(|(sources, (trigger, start, query))| {
            let options = rank(sources(trigger, cx), &query);
            let selected = self
                .menu
                .as_ref()
                .filter(|m| m.trigger == trigger)
                .map_or(0, |m| m.selected.min(options.len().saturating_sub(1)));
            (!options.is_empty()).then_some(Menu {
                trigger,
                start,
                options,
                selected,
            })
        });
        cx.notify();
    }

    fn step(&mut self, by: isize, cx: &mut Context<Self>) {
        if let Some(menu) = &mut self.menu {
            let n = menu.options.len() as isize;
            menu.selected = (menu.selected as isize + by).rem_euclid(n) as usize;
            cx.notify();
        }
    }

    /// Puts the option in the text (a chip for agents, teams and skills; "/name " for an engine command) or runs
    /// Zorel's command.
    fn pick(&mut self, at: Option<usize>, window: &mut Window, cx: &mut Context<Self>) {
        let Some(menu) = self.menu.take() else { return };
        let Some(option) = menu.options.get(at.unwrap_or(menu.selected)).cloned() else {
            return;
        };
        let end = self.text.read(cx).cursor();
        let range = menu.start..end;
        self.text.update(cx, |t, cx| {
            match (&option.run, menu.trigger) {
                (Some(_), _) => {
                    // Zorel's command runs; its "/word" leaves the text.
                    let value = t.value().to_string();
                    let cleaned = format!("{}{}", &value[..range.start], &value[range.end.min(value.len())..]);
                    t.set_value(cleaned, window, cx);
                }
                (None, Trigger::Command) => {
                    let value = t.value().to_string();
                    let next = format!(
                        "{}/{} {}",
                        &value[..range.start],
                        option.id,
                        &value[range.end.min(value.len())..]
                    );
                    t.set_value(next, window, cx);
                }
                (None, trigger) => {
                    let sigil = if trigger == Trigger::Skill { '$' } else { '@' };
                    let mark = match option.mark {
                        Mark::Face(tone) => format!("face:{tone}"),
                        Mark::Icon(_) => "plain".to_string(),
                    };
                    let token = InlineToken::new(format!("{mark}|{}", option.id), format!("{sigil}{}", option.id))
                        .with_label(option.label.clone());
                    if t.replace_range_with_token(range, token, window, cx).is_ok() {
                        t.insert(" ", window, cx);
                    }
                }
            }
        });
        if let Some(run) = option.run {
            run(window, cx);
        }
        cx.notify();
    }

    fn submit(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        let typed = self.text.read(cx).value().trim().to_string();
        if typed.is_empty() && self.files.is_empty() {
            return;
        }
        // Files alone still say something.
        let text = if typed.is_empty() {
            t!("composer.seeAttachments").into_owned()
        } else {
            typed
        };
        let files = std::mem::take(&mut self.files);
        self.error = None;
        self.menu = None;
        self.text.update(cx, |t, cx| t.set_value("", window, cx));
        cx.notify();
        (self.on_submit)(Draft { text, files }, window, cx);
    }

    fn attach(&mut self, cx: &mut Context<Self>) {
        let picked = cx.prompt_for_paths(PathPromptOptions {
            files: true,
            directories: false,
            multiple: true,
            prompt: None,
        });
        cx.spawn(async move |this, cx| {
            let Ok(Ok(Some(paths))) = picked.await else { return };
            let _ = this.update(cx, |this, cx| {
                for path in paths {
                    let size = std::fs::metadata(&path).map(|m| m.len()).unwrap_or(0);
                    let name = path
                        .file_name()
                        .map(|n| n.to_string_lossy().into_owned())
                        .unwrap_or_default();
                    if size > MAX_FILE_BYTES {
                        this.error = Some(t!("composer.tooBig", name = name).into_owned());
                    } else if this.files.len() < MAX_FILES && !this.files.contains(&path) {
                        this.files.push(path);
                    }
                }
                cx.notify();
            });
        })
        .detach();
    }

    /// The open menu, floating above the box.
    fn menu_view(&self, window: &mut Window, cx: &mut Context<Self>) -> Option<AnyElement> {
        let menu = self.menu.as_ref()?;
        let p = theme::palette(window);
        let rows: Vec<AnyElement> = menu
            .options
            .iter()
            .enumerate()
            .map(|(i, o)| {
                let on = i == menu.selected;
                let mark: AnyElement = match o.mark {
                    Mark::Face(tone) => AgentFace::new(SharedString::from(format!("menu-face-{}", o.id)), tone)
                        .size(icon::MD)
                        .into_any_element(),
                    Mark::Icon(name) => icon(name, icon::MD)
                        .text_color(if on { p.accent_text } else { p.text_muted })
                        .into_any_element(),
                };
                div()
                    .id(SharedString::from(format!("menu-option-{i}")))
                    .role(Role::ListBoxOption)
                    .aria_selected(on)
                    .flex()
                    .items_center()
                    .gap(px(space::X2_5))
                    .h(px(tokens::CONTROL_H))
                    .px(px(space::X2_5))
                    .rounded(px(tokens::RADIUS_ROW))
                    .when(on, |r| r.bg(p.bg_control))
                    .text_color(if on { p.text } else { p.text_secondary })
                    .child(div().flex_none().w(px(icon::MD)).flex().justify_center().child(mark))
                    .child(div().flex_none().max_w(px(220.)).truncate().child(o.label.clone()))
                    .when_some(o.hint.clone(), |r, h| {
                        r.child(
                            div()
                                .flex_1()
                                .min_w_0()
                                .truncate()
                                .text_sm()
                                .text_color(p.text_muted)
                                .child(h),
                        )
                    })
                    .on_mouse_move(cx.listener(move |this, _, _, cx| {
                        if let Some(m) = &mut this.menu
                            && m.selected != i
                        {
                            m.selected = i;
                            cx.notify();
                        }
                    }))
                    .on_mouse_down(
                        MouseButton::Left,
                        cx.listener(move |this, _, window, cx| {
                            cx.stop_propagation();
                            this.pick(Some(i), window, cx);
                        }),
                    )
                    .into_any_element()
            })
            .collect();
        let key = format!("composer-menu-{:?}", menu.trigger);
        Some(motion::enter(
            layout::float(div().id("composer-menu"), p)
                .absolute()
                .bottom_full()
                .left_0()
                .mb(px(space::X1_5))
                .w(px(420.))
                .max_w_full()
                .flex()
                .flex_col()
                .role(Role::ListBox)
                .children(rows),
            SharedString::from(key),
            motion::MENU_IN_MS,
            -4.,
        ))
    }
}

/// A mention or skill chip inside the text: the agent's hue (or a neutral wash), its name.
fn chip(ctx: &InlineTokenContext, window: &mut Window, _: &mut App) -> AnyElement {
    let p = theme::palette(window);
    let id = ctx.token().id().to_string();
    let tone = id
        .strip_prefix("face:")
        .and_then(|rest| rest.split('|').next())
        .and_then(|t| t.parse::<usize>().ok());
    let (bg, fg) = match tone {
        Some(tone) => {
            let hue = face::hue(p, tone);
            (face::mix(hue, 0.18, p.bg_raised), hue)
        }
        None => (p.bg_control, p.text),
    };
    div()
        .px(px(space::X1))
        .rounded(px(tokens::RADIUS_CONTROL_SM / 2.))
        .bg(if ctx.is_selected() { p.accent_soft } else { bg })
        .text_color(fg)
        .child(ctx.token().text().clone())
        .into_any_element()
}

impl Render for Composer {
    fn render(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        crate::hot::call(|| self.view(window, cx))
    }
}

impl Composer {
    // The render body, behind Subsecond's reload point (crate::hot).
    fn view(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement + use<> {
        let p = theme::palette(window);
        let chips: Vec<AnyElement> = self
            .files
            .iter()
            .enumerate()
            .map(|(i, path)| {
                let name = path
                    .file_name()
                    .map(|n| n.to_string_lossy().into_owned())
                    .unwrap_or_default();
                div()
                    .flex()
                    .items_center()
                    .gap(px(space::X1_5))
                    .h(px(tokens::CONTROL_H_SM))
                    .pl(px(space::X2_5))
                    .pr(px(space::X1))
                    .rounded_full()
                    .bg(p.bg_control)
                    .text_size(px(12.5))
                    .text_color(p.text_secondary)
                    .child(icon(IconName::File, icon::XS))
                    .child(div().max_w(px(180.)).truncate().child(name.clone()))
                    .child(
                        Button::icon_only(
                            SharedString::from(format!("remove-file-{i}")),
                            IconName::Close,
                            t!("composer.removeFile", name = name).into_owned(),
                        )
                        .size(Size::Xs)
                        .on_click(cx.listener(move |this, _, _, cx| {
                            this.files.remove(i);
                            cx.notify();
                        })),
                    )
                    .into_any_element()
            })
            .collect();
        let tools = self.tools.clone().map(|f| f(window, cx));
        let can_send = !self.text.read(cx).value().trim().is_empty() || !self.files.is_empty();
        let menu = self.menu_view(window, cx);
        let open = self.menu.is_some();
        div()
            .relative()
            .flex()
            .flex_col()
            .gap(px(space::X1_5))
            // With a menu open, the arrows, Tab and Esc are the menu's.
            .capture_key_down(cx.listener(move |this, event: &KeyDownEvent, window, cx| {
                if !open {
                    return;
                }
                match event.keystroke.key.as_str() {
                    "down" => this.step(1, cx),
                    "up" => this.step(-1, cx),
                    "tab" => this.pick(None, window, cx),
                    "escape" => {
                        this.menu = None;
                        cx.notify();
                    }
                    _ => return,
                }
                cx.stop_propagation();
            }))
            .children(menu)
            .child(
                div()
                    .rounded(px(tokens::RADIUS_CARD))
                    .bg(p.bg_raised)
                    .border_1()
                    .border_color(p.border_strong)
                    .shadow_lg()
                    .flex()
                    .flex_col()
                    .when(!chips.is_empty(), |c| {
                        c.child(
                            div()
                                .flex()
                                .flex_wrap()
                                .gap(px(space::X1_5))
                                .px(px(space::X3))
                                .pt(px(space::X2_5))
                                .children(chips),
                        )
                    })
                    .child(
                        div()
                            .px(px(if self.large { space::X4 } else { space::X3 }))
                            .pt(px(if self.large { space::X3 } else { space::X2_5 }))
                            .text_size(px(if self.large { 15. } else { 14. }))
                            .text_color(p.text)
                            .child(Textarea::new(&self.text).token(chip)),
                    )
                    .child(
                        div()
                            .flex()
                            .items_center()
                            .gap(px(space::X1))
                            .p(px(space::X1_5))
                            .child(
                                Button::icon_only("attach", IconName::Plus, t!("composer.attach").into_owned())
                                    .on_click(cx.listener(|this, _, _, cx| this.attach(cx))),
                            )
                            .child(div().flex_1())
                            .when_some(tools, |r, t| r.child(t))
                            .child(
                                Button::icon_only("send", IconName::ArrowUp, t!("composer.send").into_owned())
                                    .variant(Variant::Primary)
                                    .round()
                                    .disabled(!can_send)
                                    .on_click(cx.listener(|this, _, window, cx| this.submit(window, cx))),
                            ),
                    ),
            )
            .when_some(self.error.clone(), |c, e| {
                c.child(div().px(px(space::X1)).text_sm().text_color(p.danger).child(e))
            })
    }
}

#[cfg(test)]
mod tests {
    use super::{Mark, MenuOption, Trigger, rank, trigger_at};
    use gpui_kit::assets::IconName;

    #[test]
    fn triggers_open_where_the_cursor_is() {
        assert_eq!(
            trigger_at("hi @at", 6).map(|t| (t.0, t.1, t.2)),
            Some((Trigger::Mention, 3, "at"))
        );
        assert_eq!(trigger_at("#", 1).map(|t| t.0), Some(Trigger::Lead));
        assert_eq!(trigger_at("mail me@x", 9), None); // not after a space
        assert_eq!(trigger_at("/comp", 5).map(|t| t.2), Some("comp"));
        assert_eq!(trigger_at("a /comp", 7), None); // a command only at a line's start
        assert_eq!(trigger_at("a\n/new", 6).map(|t| t.0), Some(Trigger::Command));
        assert_eq!(trigger_at("ok $sk", 6).map(|t| t.0), Some(Trigger::Skill));
    }

    #[test]
    fn options_rank_by_handle_then_name() {
        let o = |id: &str, label: &str| MenuOption {
            id: id.into(),
            label: label.into(),
            hint: None,
            mark: Mark::Icon(IconName::Search),
            run: None,
        };
        let ranked = rank(
            vec![o("rosa", "Rosa"), o("atlas", "Atlas"), o("nova", "Nova Atlas")],
            "at",
        );
        let ids: Vec<&str> = ranked.iter().map(|o| o.id.as_str()).collect();
        assert_eq!(ids, ["atlas", "nova"]);
    }
}
