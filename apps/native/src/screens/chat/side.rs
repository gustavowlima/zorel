// The chat's side panel (apps/web/src/features/workspace.tsx › SidePanel), beside the conversation: its tabs (only
// those opened; + opens more, × closes one, closing the last closes the panel), a left edge that drags its width
// (360 to 70% of the window, kept in the preferences), and the open tab's body. Changes lists the turns that
// changed files, newest first: a turn opens to its files (status, path, +/−) and their diffs (ui/diff), fetched once
// per turn; a file narrows the diffs to it. "View" on a reply's changes opens the panel on that turn.
// Files: screens/chat/files.rs; Pull request: screens/chat/git.rs. ponytail: Browser and Terminal come next (parity/chat.md › C); the +
// menu lists what exists (folder-only tabs only with a folder).
use super::*;

use crate::{
    net::types::{ChatsDiffSuccess, FileChangeStatus},
    state::prefs::Prefs,
    ui::diff,
};

pub const MIN_WIDTH: f32 = 360.;
const DEFAULT_WIDTH: f32 = 560.;

#[derive(Clone, Copy, PartialEq, Debug)]
pub enum Tab {
    Changes,
    Git,
    Files,
    Browser,
    Yours,
    Terminal,
}

impl Tab {
    const ALL: [Tab; 6] = [
        Tab::Changes,
        Tab::Git,
        Tab::Files,
        Tab::Browser,
        Tab::Yours,
        Tab::Terminal,
    ];

    fn label(self) -> String {
        match self {
            Tab::Changes => t!("workspace.changes").into_owned(),
            Tab::Git => t!("git.pullRequest").into_owned(),
            Tab::Files => t!("workspace.files").into_owned(),
            Tab::Browser => t!("browser.agents").into_owned(),
            Tab::Yours => t!("browser.yours").into_owned(),
            Tab::Terminal => t!("workspace.terminal").into_owned(),
        }
    }

    fn icon(self) -> IconName {
        match self {
            Tab::Changes => IconName::PanelRight,
            Tab::Git => IconName::GitPullRequest,
            Tab::Files => IconName::Folder,
            Tab::Browser => IconName::Globe,
            Tab::Yours => IconName::MousePointerClick,
            Tab::Terminal => IconName::SquareTerminal,
        }
    }

    /// Needs the project's folder.
    fn folder_only(self) -> bool {
        matches!(self, Tab::Files | Tab::Git | Tab::Terminal)
    }
}

/// The panel while open: its tabs, the shown one (none open: what can open, in its middle), and which turn (and
/// file) Changes shows.
#[derive(Default)]
pub struct Side {
    tabs: Vec<Tab>,
    current: Option<Tab>,
    pub(super) focus: Option<(String, Option<String>)>,
}

/// A turn's diff, each file's patch parsed once.
pub struct TurnDiff {
    files: Vec<(crate::net::types::FileDiff, Vec<diff::Line>)>,
}

/// +added −removed, quiet.
pub(super) fn delta(added: f64, removed: f64, p: &Palette) -> Div {
    div()
        .flex()
        .flex_none()
        .gap(px(space::X1))
        .text_xs()
        .child(div().text_color(p.success).child(format!("+{added:.0}")))
        .child(div().text_color(p.danger).child(format!("−{removed:.0}")))
}

fn status_mark(status: FileChangeStatus, p: &Palette) -> Div {
    let (letter, color) = match status {
        FileChangeStatus::Added => ("A", p.success),
        FileChangeStatus::Modified => ("M", p.warning),
        FileChangeStatus::Deleted => ("D", p.danger),
    };
    div()
        .flex_none()
        .w(px(14.))
        .text_xs()
        .font_weight(FontWeight::SEMIBOLD)
        .text_color(color)
        .child(letter)
}

impl ChatScreen {
    /// The changed lines of the chat's turns not undone (for the header's toggle).
    pub fn delta(&self) -> (f64, f64) {
        self.log
            .messages
            .iter()
            .filter(|m| m.reverted_at.is_none())
            .flat_map(|m| m.changes.iter())
            .fold((0., 0.), |(a, r), c| (a + c.added, r + c.removed))
    }

    /// Whether the chat's project has a folder (Files, Pull request and Terminal need one).
    fn has_folder(&self, cx: &App) -> bool {
        let store = self.store.read(cx);
        store
            .chat(&self.chat_id)
            .and_then(|c| c.project_id.as_deref())
            .and_then(|id| store.projects.iter().find(|p| p.id == id))
            .is_some_and(|p| p.path.is_some())
    }

    pub fn side_open(&self) -> bool {
        self.side.is_some()
    }

    /// The header's toggle: opens empty (what can open, in its middle), or closes.
    pub fn toggle_side(&mut self, cx: &mut Context<Self>) {
        self.hide_native(cx);
        self.side = match self.side.take() {
            Some(_) => None,
            None => Some(Side::default()),
        };
        cx.notify();
    }

    /// "View" on a reply's changes: the panel on that turn.
    pub(super) fn view_turn(&mut self, turn: String, cx: &mut Context<Self>) {
        let side = self.side.get_or_insert_with(Side::default);
        if !side.tabs.contains(&Tab::Changes) {
            side.tabs.push(Tab::Changes);
        }
        side.current = Some(Tab::Changes);
        side.focus = Some((turn, None));
        cx.notify();
    }

    pub(super) fn open_tab(&mut self, tab: Tab, cx: &mut Context<Self>) {
        // Git is read fresh each time it's shown (a shell or an agent may have committed meanwhile).
        if tab == Tab::Git {
            self.load_git(cx);
        }
        if let Some(side) = &mut self.side {
            if !side.tabs.contains(&tab) {
                side.tabs.push(tab);
            }
            side.current = Some(tab);
        }
        cx.notify();
    }

    fn close_tab(&mut self, tab: Tab, cx: &mut Context<Self>) {
        if let Some(side) = &mut self.side {
            let at = side.tabs.iter().position(|t| *t == tab).unwrap_or(0);
            side.tabs.retain(|t| *t != tab);
            // The last one closed leaves the panel open on what can open.
            side.current = side.tabs.get(at.saturating_sub(1)).or(side.tabs.first()).copied();
        }
        cx.notify();
    }

    fn focus_turn(&mut self, focus: Option<(String, Option<String>)>, cx: &mut Context<Self>) {
        if let Some(side) = &mut self.side {
            side.focus = focus;
        }
        cx.notify();
    }

    /// A turn's diff, fetched once.
    fn turn_diff(&mut self, turn: &str, cx: &mut Context<Self>) -> Remote<std::rc::Rc<TurnDiff>> {
        if let Some(known) = self.diffs.get(turn) {
            return known.clone();
        }
        self.diffs.insert(turn.to_string(), Remote::Loading);
        let (http, turn) = (self.store.read(cx).http.clone(), turn.to_string());
        let path = format!("/api/turns/{turn}/diff");
        cx.spawn(async move |this, cx| {
            let got = runtime::spawn(async move { http.get::<ChatsDiffSuccess>(&path).await }).await;
            let parsed = match got {
                Ok(Ok(d)) => {
                    let files = d.files.into_iter().map(|f| {
                        let lines = diff::parse(&f.patch);
                        (f, lines)
                    });
                    Remote::Ready(std::rc::Rc::new(TurnDiff { files: files.collect() }))
                }
                Ok(Err(e)) => {
                    eprintln!("diff: {e}");
                    Remote::Failed
                }
                Err(_) => Remote::Failed,
            };
            let _ = this.update(cx, |this, cx| {
                this.diffs.insert(turn, parsed);
                cx.notify();
            });
        })
        .detach();
        Remote::Loading
    }

    /// The panel's width now (the preference, within what the window allows).
    pub(super) fn side_width(&self, window: &Window) -> f32 {
        let max = f32::from(window.viewport_size().width) * 0.7;
        self.side_width.clamp(MIN_WIDTH, max.max(MIN_WIDTH))
    }

    /// The left edge was pressed: a drag resizes until the button is let go.
    pub(super) fn start_resize(&mut self, x: f32, window: &Window) {
        self.resizing = Some((x, self.side_width(window)));
    }

    pub(super) fn resize_to(&mut self, x: f32, window: &Window, cx: &mut Context<Self>) {
        let Some((start, width)) = self.resizing else { return };
        let max = f32::from(window.viewport_size().width) * 0.7;
        self.side_width = (width + (start - x)).clamp(MIN_WIDTH, max.max(MIN_WIDTH));
        cx.notify();
    }

    pub(super) fn end_resize(&mut self, cx: &mut App) {
        if self.resizing.take().is_some() {
            let width = self.side_width;
            Prefs::update(cx, |p| p.side_width = width);
        }
    }

    pub(super) fn initial_side_width(cx: &App) -> f32 {
        let w = Prefs::get(cx).side_width;
        if w >= MIN_WIDTH { w } else { DEFAULT_WIDTH }
    }

    /// The panel, while open.
    pub(super) fn side_panel(&mut self, window: &mut Window, cx: &mut Context<Self>) -> Option<AnyElement> {
        let (tabs, current) = {
            let side = self.side.as_ref()?;
            (side.tabs.clone(), side.current)
        };
        let p = theme::palette(window);
        let width = self.side_width(window);
        let (added, removed) = self.delta();
        let pills = tabs.iter().map(|&tab| {
            let selected = Some(tab) == current;
            div()
                .id(SharedString::from(format!("side-tab-{tab:?}")))
                .flex()
                .flex_none()
                .items_center()
                .gap(px(space::X1_5))
                .h(px(tokens::CONTROL_H_SM))
                .pl(px(space::X2_5))
                .pr(px(space::X1))
                .rounded(px(tokens::RADIUS_CONTROL_SM))
                .text_sm()
                .when(selected, |d| d.bg(p.bg_control).text_color(p.text))
                .when(!selected, |d| d.text_color(p.text_muted).hover(|s| s.bg(p.bg_control)))
                .child(icon(tab.icon(), icon::XS))
                .child(tab.label())
                .when(tab == Tab::Changes && added + removed > 0., |d| {
                    d.child(delta(added, removed, p))
                })
                .child(
                    Button::icon_only(
                        SharedString::from(format!("side-close-{tab:?}")),
                        IconName::X,
                        t!("workspace.closeTab", name = tab.label()).into_owned(),
                    )
                    .size(Size::Xs)
                    .on_click(cx.listener(move |this, _, _, cx| this.close_tab(tab, cx))),
                )
                .on_click(cx.listener(move |this, _, _, cx| this.open_tab(tab, cx)))
        });
        let view = cx.entity().downgrade();
        let folder = self.has_folder(cx);
        let items: crate::ui::menu::Items = Rc::new(move || {
            let mut m = crate::ui::menu::Menu::default();
            for tab in Tab::ALL.into_iter().filter(|t| folder || !t.folder_only()) {
                let view = view.clone();
                m = m
                    .item(tab.label(), move |_, cx| {
                        let _ = view.update(cx, |this, cx| this.open_tab(tab, cx));
                    })
                    .icon(tab.icon());
            }
            m.build()
        });
        let head = div()
            .flex()
            .flex_none()
            .items_center()
            .gap(px(space::X2))
            .px(px(space::X3))
            .py(px(space::X2))
            .border_b_1()
            .border_color(p.border)
            .child(
                div()
                    .flex()
                    .flex_1()
                    .min_w_0()
                    .gap(px(space::X1))
                    .overflow_hidden()
                    .children(pills),
            )
            // + only beside open tabs; with none, the panel's middle lists them.
            .when(!tabs.is_empty(), |d| {
                d.child(crate::ui::menu::dropdown(
                    "side-add",
                    Button::icon_only("side-add-trigger", IconName::Plus, t!("workspace.openTab").into_owned())
                        .size(Size::Xs),
                    items,
                ))
            })
            .child(
                Button::icon_only("side-close", IconName::X, t!("workspace.closePanel").into_owned())
                    .size(Size::Xs)
                    .on_click(cx.listener(|this, _, _, cx| {
                        this.hide_native(cx);
                        this.side = None;
                        cx.notify();
                    })),
            );
        let body = match current {
            None => self.launcher(folder, window, cx),
            Some(Tab::Changes) => self.changes_tab(window, cx),
            Some(Tab::Files) => self.files_tab(window, cx),
            Some(Tab::Git) => self.git_tab(window, cx),
            Some(Tab::Terminal) => self.terminal_tab(window, cx),
            Some(Tab::Browser) => self.browser_tab(window, cx),
            Some(Tab::Yours) => self.yours_tab(window, cx),
        };
        // The native page shows only while its tab is on screen and nothing covers the chat.
        if current != Some(Tab::Yours) {
            self.hide_native(cx);
        } else if let Some(b) = &self.local_browser {
            let covered = self.crew_agent.is_some()
                || self.viewing.is_some()
                || self.builder.as_ref().is_some_and(|m| m.editing.is_some());
            b.update(cx, |b, _| b.covered = covered);
        }
        // The left edge: a hairline that lights on hover, a wider grip to drag.
        let edge = div()
            .id("side-edge")
            .absolute()
            .top_0()
            .bottom_0()
            .left(px(-4.))
            .w(px(8.))
            .cursor(CursorStyle::ResizeLeftRight)
            .child(div().absolute().top_0().bottom_0().left(px(4.)).w(px(1.)).bg(p.border))
            .hover(|s| s.bg(motion::fade(p.accent, 0.25)))
            .on_mouse_down(
                MouseButton::Left,
                cx.listener(|this, e: &MouseDownEvent, window, cx| {
                    this.start_resize(f32::from(e.position.x), window);
                    cx.stop_propagation();
                }),
            );
        Some(
            div()
                .relative()
                .flex()
                .flex_col()
                .flex_none()
                .w(px(width))
                .h_full()
                .child(edge)
                .child(head)
                .child(match current {
                    // Files scrolls its own tree and file.
                    Some(Tab::Files | Tab::Terminal | Tab::Browser | Tab::Yours) => {
                        div().id("side-body").flex_1().min_h_0().child(body)
                    }
                    _ => div().id("side-body").flex_1().min_h_0().overflow_y_scroll().child(body),
                })
                .into_any_element(),
        )
    }

    /// No tab open: what can open (folder-only ones only with a folder), as a centred column of buttons.
    fn launcher(&self, folder: bool, window: &Window, cx: &mut Context<Self>) -> AnyElement {
        let p = theme::palette(window);
        let options = Tab::ALL.into_iter().filter(|t| folder || !t.folder_only()).map(|tab| {
            div()
                .id(SharedString::from(format!("side-open-{tab:?}")))
                .w_full()
                .flex()
                .items_center()
                .gap(px(space::X2_5))
                .h(px(44.))
                .px(px(space::X3))
                .rounded(px(tokens::RADIUS_CONTROL))
                .border_1()
                .border_color(p.border)
                .bg(p.bg_surface)
                .text_sm()
                .font_weight(FontWeight::MEDIUM)
                .text_color(p.text)
                .cursor_pointer()
                .hover(|s| s.bg(p.bg_control).border_color(p.border_strong))
                .child(icon(tab.icon(), icon::SM).text_color(p.text_muted))
                .child(tab.label())
                .on_click(cx.listener(move |this, _, _, cx| this.open_tab(tab, cx)))
        });
        div()
            .size_full()
            .flex()
            .items_center()
            .justify_center()
            .p(px(space::X4))
            .child(
                div()
                    .w_full()
                    .max_w(px(280.))
                    .flex()
                    .flex_col()
                    .gap(px(space::X2))
                    .children(options),
            )
            .into_any_element()
    }

    fn changes_tab(&mut self, window: &mut Window, cx: &mut Context<Self>) -> AnyElement {
        let p = theme::palette(window);
        let turns: Vec<Message> = self
            .log
            .messages
            .iter()
            .filter(|m| !m.changes.is_empty() && m.turn_id.is_some())
            .rev()
            .cloned()
            .collect();
        if turns.is_empty() {
            return div()
                .flex()
                .flex_col()
                .items_center()
                .justify_center()
                .gap(px(space::X2))
                .h_full()
                .min_h(px(240.))
                .px(px(space::X6))
                .text_center()
                .child(icon(IconName::File, icon::MD).text_color(p.text_dim))
                .child(
                    div()
                        .font_weight(FontWeight::MEDIUM)
                        .child(t!("workspace.noChanges").into_owned()),
                )
                .child(
                    div()
                        .text_sm()
                        .text_color(p.text_muted)
                        .child(t!("workspace.noChangesHint").into_owned()),
                )
                .into_any_element();
        }
        let focus = self.side.as_ref().and_then(|s| s.focus.clone());
        let current = focus
            .clone()
            .unwrap_or_else(|| (turns[0].turn_id.clone().unwrap_or_default(), None));
        let mut sections: Vec<AnyElement> = Vec::new();
        for m in &turns {
            let turn = m.turn_id.clone().unwrap_or_default();
            let open = turn == current.0;
            let (added, removed) = m
                .changes
                .iter()
                .fold((0., 0.), |(a, r), c| (a + c.added, r + c.removed));
            let who = self.store.read(cx).agent_name(m.agent_id.as_deref());
            let when = format::time(m.at, format::now_ms(), format::lang());
            let toggle_turn = turn.clone();
            let head = div()
                .id(SharedString::from(format!("side-turn-{turn}")))
                .flex()
                .items_center()
                .gap(px(space::X2))
                .px(px(space::X4))
                .py(px(space::X2_5))
                .hover(|s| s.bg(p.bg_control))
                .child(
                    icon(
                        if open {
                            IconName::ChevronDown
                        } else {
                            IconName::ChevronRight
                        },
                        icon::XS,
                    )
                    .text_color(p.text_muted),
                )
                .child(
                    div()
                        .flex_1()
                        .min_w_0()
                        .truncate()
                        .text_color(p.text_secondary)
                        .child(t!("workspace.turnBy", agent = who, time = when).into_owned()),
                )
                .child(if m.reverted_at.is_some() {
                    div()
                        .text_sm()
                        .text_color(p.text_muted)
                        .child(t!("workspace.undone").into_owned())
                } else {
                    delta(added, removed, p)
                })
                .on_click(cx.listener(move |this, _, _, cx| {
                    // Pressing the open turn closes it.
                    let next = (!open).then(|| (toggle_turn.clone(), None));
                    this.focus_turn(next.or(Some((String::new(), None))), cx)
                }));
            let mut section = div().flex().flex_col().border_b_1().border_color(p.border).child(head);
            if open {
                section = section.child(self.turn_files(m, current.1.clone(), window, cx));
            }
            sections.push(section.into_any_element());
        }
        div().flex().flex_col().children(sections).into_any_element()
    }

    /// An open turn: its files (one narrows the diffs to it), then the diffs.
    fn turn_files(
        &mut self,
        m: &Message,
        path: Option<String>,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> AnyElement {
        let p = theme::palette(window);
        let turn = m.turn_id.clone().unwrap_or_default();
        let diff = self.turn_diff(&turn, cx);
        let rows: Vec<AnyElement> = m
            .changes
            .iter()
            .map(|c| {
                let (turn, file) = (turn.clone(), c.path.clone());
                let selected = path.as_deref() == Some(c.path.as_str());
                div()
                    .id(SharedString::from(format!("side-file-{turn}-{}", c.path)))
                    .flex()
                    .items_center()
                    .gap(px(space::X2))
                    .h(px(tokens::CONTROL_H))
                    .px(px(space::X2))
                    .rounded(px(tokens::RADIUS_ROW))
                    .when(selected, |d| d.bg(p.bg_control))
                    .hover(|s| s.bg(p.bg_control))
                    .child(status_mark(c.status, p))
                    .child(
                        div()
                            .flex_1()
                            .min_w_0()
                            .truncate()
                            .font_family(MONO)
                            .text_sm()
                            .text_color(p.text_secondary)
                            .child(c.path.clone()),
                    )
                    .child(delta(c.added, c.removed, p))
                    .on_click(cx.listener(move |this, _, _, cx| {
                        let next = (!selected).then(|| file.clone());
                        this.focus_turn(Some((turn.clone(), next)), cx)
                    }))
                    .into_any_element()
            })
            .collect();
        let shown: Vec<AnyElement> = match &diff {
            Remote::Failed => vec![
                div()
                    .px(px(space::X2))
                    .text_sm()
                    .text_color(p.text_muted)
                    .child(t!("common.loadFailed").into_owned())
                    .into_any_element(),
            ],
            Remote::Loading => vec![
                div()
                    .flex()
                    .items_center()
                    .gap(px(space::X2))
                    .px(px(space::X2))
                    .text_sm()
                    .text_color(p.text_muted)
                    .child(Loader::new(SharedString::from(format!("diff-{turn}"))).size(icon::XS))
                    .child(t!("workspace.loadingDiff").into_owned())
                    .into_any_element(),
            ],
            Remote::Ready(d) => d
                .files
                .iter()
                .filter(|(f, _)| path.as_deref().is_none_or(|x| x == f.path))
                .map(|(f, lines)| {
                    div()
                        .flex()
                        .flex_col()
                        .rounded(px(tokens::RADIUS_CARD))
                        .border_1()
                        .border_color(p.border)
                        .overflow_hidden()
                        .child(
                            div()
                                .flex()
                                .items_center()
                                .gap(px(space::X2))
                                .px(px(space::X3))
                                .py(px(space::X1_5))
                                .border_b_1()
                                .border_color(p.border)
                                .bg(p.bg_surface)
                                .child(
                                    div()
                                        .flex_1()
                                        .min_w_0()
                                        .truncate()
                                        .font_family(MONO)
                                        .text_sm()
                                        .child(f.path.clone()),
                                )
                                .child(delta(f.added, f.removed, p)),
                        )
                        .child(if f.patch.is_empty() {
                            div()
                                .px(px(space::X3))
                                .py(px(space::X2))
                                .text_sm()
                                .text_color(p.text_muted)
                                .child(t!("workspace.binary").into_owned())
                                .into_any_element()
                        } else {
                            diff::render(lines, window)
                        })
                        .into_any_element()
                })
                .collect(),
        };
        div()
            .flex()
            .flex_col()
            .gap(px(space::X2))
            .px(px(space::X3))
            .pb(px(space::X3))
            .child(div().flex().flex_col().children(rows))
            .children(shown)
            .into_any_element()
    }
}

impl ChatScreen {
    /// A new shell in the chat's folder, shown.
    fn new_shell(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        let http = self.store.read(cx).http.clone();
        let view = cx.entity().downgrade();
        let add: crate::screens::terminal::OnText = Rc::new(move |text, _, cx| {
            let _ = view.update(cx, |this, cx| this.add_to_chat(text, cx));
        });
        let chat = self.chat_id.clone();
        let shell = cx.new(|cx| crate::screens::terminal::Shell::new(http, chat, None, Some(add), cx));
        shell.update(cx, |s, cx| s.focus(window, cx));
        self.shells.push(shell);
        self.shell_at = self.shells.len() - 1;
        cx.notify();
    }

    /// Ends a shell and closes its tab.
    fn close_shell(&mut self, at: usize, cx: &mut Context<Self>) {
        if at < self.shells.len() {
            self.shells.remove(at).read(cx).kill();
            self.shell_at = self.shell_at.min(self.shells.len().saturating_sub(1));
        }
        cx.notify();
    }

    /// The Terminal tab: its shells as tabs (+ opens one, × ends one), the shown one below. Shells stay alive while
    /// another tab shows.
    fn terminal_tab(&mut self, window: &mut Window, cx: &mut Context<Self>) -> AnyElement {
        let p = theme::palette(window);
        if self.shells.is_empty() {
            self.new_shell(window, cx);
        }
        let strip = self.shells.iter().enumerate().map(|(i, s)| {
            let n = s.read(cx).n;
            let name = t!("workspace.shell", n = if n > 0 { n } else { i as u32 + 1 }).into_owned();
            let selected = i == self.shell_at;
            div()
                .id(SharedString::from(format!("shell-tab-{i}")))
                .flex()
                .flex_none()
                .items_center()
                .gap(px(space::X1))
                .pl(px(space::X2_5))
                .pr(px(space::X1))
                .h(px(tokens::CONTROL_H_SM))
                .rounded(px(tokens::RADIUS_CONTROL_SM))
                .text_sm()
                .map(|d| {
                    if selected {
                        d.bg(p.bg_control).text_color(p.text)
                    } else {
                        d.text_color(p.text_muted)
                    }
                })
                .hover(|s| s.bg(p.bg_control))
                .child(icon(IconName::SquareTerminal, icon::XS))
                .child(name.clone())
                .child(
                    Button::icon_only(
                        SharedString::from(format!("shell-close-{i}")),
                        IconName::X,
                        t!("workspace.closeShellNamed", name = name).into_owned(),
                    )
                    .size(Size::Xs)
                    .on_click(cx.listener(move |this, _, _, cx| this.close_shell(i, cx))),
                )
                .on_click(cx.listener(move |this, _, window, cx| {
                    this.shell_at = i;
                    if let Some(s) = this.shells.get(i) {
                        s.update(cx, |s, cx| s.focus(window, cx));
                    }
                    cx.notify();
                }))
        });
        let shown = self.shells.get(self.shell_at).cloned();
        div()
            .flex()
            .flex_col()
            .size_full()
            .child(
                div()
                    .id("shell-strip")
                    .flex()
                    .flex_none()
                    .items_center()
                    .gap(px(space::X1))
                    .px(px(space::X3))
                    .py(px(space::X1_5))
                    .overflow_x_scroll()
                    .border_b_1()
                    .border_color(p.border)
                    .children(strip)
                    .child(
                        Button::icon_only("shell-new", IconName::Plus, t!("workspace.newShell").into_owned())
                            .size(Size::Xs)
                            .on_click(cx.listener(|this, _, window, cx| this.new_shell(window, cx))),
                    ),
            )
            .child(div().flex_1().min_h_0().children(shown))
            .into_any_element()
    }
}

impl ChatScreen {
    /// The Browser tab: the chat's browser view, made once and kept while the chat is open.
    fn browser_tab(&mut self, window: &mut Window, cx: &mut Context<Self>) -> AnyElement {
        if self.browser.is_none() {
            let (http, store, chat) = (
                self.store.read(cx).http.clone(),
                self.store.clone(),
                self.chat_id.clone(),
            );
            self.browser = Some(cx.new(|cx| crate::screens::browser::Browser::new(http, store, chat, window, cx)));
        }
        div().size_full().children(self.browser.clone()).into_any_element()
    }
}

impl ChatScreen {
    /// "Your browser": the system's web view, made once and kept while the chat is open; a picked element goes to the
    /// message box.
    fn yours_tab(&mut self, window: &mut Window, cx: &mut Context<Self>) -> AnyElement {
        if self.local_browser.is_none() {
            let view = cx.entity().downgrade();
            let on_pick: crate::screens::webview::OnPick = Rc::new(move |text, _, cx| {
                let _ = view.update(cx, |this, cx| this.add_to_chat(text, cx));
            });
            self.local_browser = Some(cx.new(|cx| crate::screens::webview::LocalBrowser::new(on_pick, window, cx)));
        }
        div()
            .size_full()
            .children(self.local_browser.clone())
            .into_any_element()
    }

    /// Hides the native page (the panel closed, another tab, the chat left).
    pub fn hide_native(&self, cx: &App) {
        if let Some(b) = &self.local_browser {
            b.read(cx).hide();
        }
    }

    /// Opens a page in "Your browser" (a server's address).
    pub fn open_in_yours(&mut self, url: String, window: &mut Window, cx: &mut Context<Self>) {
        if self.side.is_none() {
            self.toggle_side(cx);
        }
        self.open_tab(Tab::Yours, cx);
        self.yours_tab(window, cx);
        if let Some(b) = &self.local_browser {
            b.update(cx, |b, cx| b.go(&url, cx));
        }
    }
}
