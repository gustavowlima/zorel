// One chat (apps/web/src/features/chat.tsx, prototype Chat): the timeline in the kit's MessageScroller (virtualised,
// follows the tail while you're there, keeps your place when you scroll up), then what waits for you, the queue, the
// Stop pill and the composer with the chat's model.
// - You: a bubble on the right (the prototype's 16/16/6/16 corners), copy and time on hover.
// - Replies: the agent's face and name (not in a solo chat, nor when it continues its own reply within 5 minutes);
//   the text cut where its steps began, each run of steps one line ("Read 2 files and ran 3 commands") that opens to
//   them; how it ended (stopped, a limit, or Failed with the error and Try again / Continue).
// - A live turn: its steps as they happen, the text revealed smoothly (a few frames per delta, not in jumps), and a
//   status line (the working ring, what it does now, how long once past 5s) that breathes.
// - New rows fade in and rise (motion::enter); the history already there doesn't animate.
// ponytail: mentions/skills/commands menus in the box, rewind, turn changes and undo, the side panel and its tools,
// team picker, context meter and memory chips come with the following passes (parity/chat.md).
use std::{
    collections::{HashMap, HashSet},
    rc::Rc,
    time::Duration,
};

use gpui_kit::{
    assets::IconName,
    base::input::TextareaState,
    component::message_scroller::{MessageScroller, MessageScrollerState},
    prelude::FluentBuilder,
    *,
};
use rust_i18n::t;
use serde_json::json;

use crate::{
    format,
    i18n::tn,
    net::{
        rpc::Rpc,
        types::{Message, MessageRole, Step, StepStatus, SubscribeChatItem, WorkStep, WorkStepStatus},
    },
    runtime,
    screens::{
        approval,
        composer::{Composer, Draft},
        model_picker::{ModelChoice, ModelPicker},
    },
    state::{
        chat::ChatLog,
        steps::{self, Piece, Summed, Tone},
        store::Store,
    },
    theme::{self, tokens, tokens::Palette},
    ui::{
        button::{Button, Size, Variant},
        code::MONO,
        face::{self, AgentFace, FaceState, WorkingRing},
        icon::{self, icon},
        markdown::{self, Block},
        motion, space,
    },
};

/// The timeline's column (prototype: a comfortable reading width).
const COLUMN: f32 = 720.;
/// A reply continues the previous one (no face, no name) when the same agent answers within this.
const CONTINUES_MS: f64 = 5. * 60. * 1000.;
/// Frames a revealed delta takes to show (the web's ~6).
const REVEAL_FRAMES: usize = 6;

pub enum ChatEvent {
    Navigate(crate::route::Route),
}

impl EventEmitter<ChatEvent> for ChatScreen {}

/// What a list row shows.
#[derive(Clone, PartialEq)]
enum Row {
    Message(usize),
    Live(String),
    Empty,
}

pub struct ChatScreen {
    chat_id: String,
    store: Entity<Store>,
    rpc: Rpc,
    log: ChatLog,
    rows: Vec<Row>,
    scroller: Entity<MessageScrollerState>,
    /// Parsed markdown per message (and piece): a finished message is parsed once.
    parsed: HashMap<String, Vec<Block>>,
    /// Ids that arrived after the history loaded: they enter with motion, once.
    fresh: HashSet<String>,
    loaded: bool,
    /// How much of each live turn's text is on screen (chars), catching up a few frames per delta.
    shown: HashMap<String, usize>,
    ticking: bool,
    /// Step groups and steps opened, by key.
    open: HashSet<String>,
    /// A message whose text was just copied (its ✓ for a moment).
    copied: Option<String>,
    composer: Entity<Composer>,
    model: Entity<ModelPicker>,
    /// Messages written while a reply runs: sent one at a time when the chat is idle.
    queue: Vec<Draft>,
    answers: HashMap<String, Entity<TextareaState>>,
    _subscriptions: Vec<Subscription>,
}

impl ChatScreen {
    pub fn new(chat_id: String, store: Entity<Store>, window: &mut Window, cx: &mut Context<Self>) -> Self {
        let rpc = store.read(cx).rpc.clone();
        let scroller = cx.new(|cx| MessageScrollerState::new(0, cx));
        let view = cx.entity().downgrade();
        let composer = cx.new(|cx| {
            let on_submit: crate::screens::composer::OnSubmit = Rc::new(move |draft, window, cx| {
                let _ = view.update(cx, |this, cx| this.submit(draft, window, cx));
            });
            Composer::new(t!("composer.placeholder").into_owned(), false, on_submit, window, cx)
        });
        let view = cx.entity().downgrade();
        let id = chat_id.clone();
        let on_change: crate::screens::model_picker::OnChange = Rc::new(move |choice, _, cx| {
            let _ = view.update(cx, |this, cx| this.set_model(choice, cx));
            let _ = &id;
        });
        let model = cx.new(|cx| ModelPicker::new(store.clone(), true, on_change, window, cx));
        let tools = model.clone();
        composer.update(cx, |c, _| {
            c.set_tools(Rc::new(move |_, _| tools.clone().into_any_element()))
        });
        // The engine's own slash commands for this chat (Claude Code's built-in, the user's, the project's).
        let commands: Rc<std::cell::RefCell<Vec<crate::net::types::EngineCommand>>> = Default::default();
        let sources = Self::sources(&chat_id, &store, commands.clone(), cx.entity().downgrade());
        composer.update(cx, |c, _| c.set_sources(sources));
        composer.update(cx, |c, cx| c.focus(window, cx));
        {
            let (http, path, commands) = (
                store.read(cx).http.clone(),
                format!("/api/chats/{chat_id}/commands"),
                commands.clone(),
            );
            cx.spawn(async move |_, _| {
                if let Ok(Ok(list)) =
                    runtime::spawn(async move { http.get::<crate::net::types::ChatsCommandsSuccess>(&path).await })
                        .await
                {
                    *commands.borrow_mut() = list.0;
                }
            })
            .detach();
        }
        let subscriptions = vec![
            cx.observe(&store, |_, _, cx| cx.notify()), // names, hues, the chat's model
            cx.observe(&scroller, |_, _, cx| cx.notify()),
        ];
        let mut events = rpc.stream::<SubscribeChatItem>("subscribeChat", Some(json!({ "chatId": chat_id })));
        cx.spawn(async move |this, cx| {
            while let Some(event) = events.recv().await {
                if this.update(cx, |this, cx| this.apply(event, cx)).is_err() {
                    return; // the screen is gone; dropping `events` stops the stream
                }
            }
        })
        .detach();
        Self {
            chat_id,
            store,
            rpc,
            log: ChatLog::default(),
            rows: vec![Row::Empty],
            scroller,
            parsed: HashMap::new(),
            fresh: HashSet::new(),
            loaded: false,
            shown: HashMap::new(),
            ticking: false,
            open: HashSet::new(),
            copied: None,
            composer,
            model,
            queue: Vec::new(),
            answers: HashMap::new(),
            _subscriptions: subscriptions,
        }
    }

    /// What the composer's menus offer here: the chat's people and teams, the skills in its reach, the commands.
    fn sources(
        chat_id: &str,
        store: &Entity<Store>,
        commands: Rc<std::cell::RefCell<Vec<crate::net::types::EngineCommand>>>,
        view: WeakEntity<Self>,
    ) -> crate::screens::composer::Sources {
        use crate::screens::composer::{Mark, MenuOption, Trigger};
        let (chat_id, store) = (chat_id.to_string(), store.clone());
        Rc::new(move |trigger, cx| {
            let s = store.read(cx);
            let Some(chat) = s.chat(&chat_id) else {
                return Vec::new();
            };
            match trigger {
                Trigger::Lead | Trigger::Mention => {
                    crate::screens::mentions::people(s, chat.project_id.as_deref(), Some(&chat.agent_ids))
                }
                Trigger::Skill => {
                    let mut scopes = vec!["user".to_string()];
                    scopes.extend(chat.project_id.as_ref().map(|p| format!("project:{p}")));
                    scopes.extend(chat.agent_ids.iter().map(|a| format!("agent:{a}")));
                    crate::screens::mentions::skills(s, &scopes)
                }
                Trigger::Command => {
                    let project = chat.project_id.clone();
                    let (compact, fresh) = (view.clone(), view.clone());
                    let mut out = vec![
                        MenuOption {
                            id: "compact".into(),
                            label: t!("composer.command.compact").into_owned(),
                            hint: Some(t!("composer.command.compactHint").into_owned()),
                            mark: Mark::Icon(IconName::Minimize2),
                            run: Some(Rc::new(move |_, cx| {
                                let _ = compact.update(cx, |this, cx| this.compact(cx));
                            })),
                        },
                        MenuOption {
                            id: "new".into(),
                            label: t!("composer.command.newChat").into_owned(),
                            hint: Some(t!("composer.command.newChatHint").into_owned()),
                            mark: Mark::Icon(IconName::SquarePen),
                            run: Some(Rc::new(move |_, cx| {
                                let project_id = project.clone();
                                let _ = fresh.update(cx, |_, cx| {
                                    cx.emit(ChatEvent::Navigate(crate::route::Route::Home { project_id }))
                                });
                            })),
                        },
                    ];
                    out.extend(commands.borrow().iter().map(|c| MenuOption {
                        id: c.name.clone(),
                        label: match &c.argument_hint {
                            Some(h) => format!("/{} {h}", c.name),
                            None => format!("/{}", c.name),
                        },
                        hint: Some(c.description.clone()),
                        mark: Mark::Icon(IconName::SquareTerminal),
                        run: None,
                    }));
                    out
                }
            }
        })
    }

    /// Folds the older messages into the chat's summary (the /compact command).
    fn compact(&mut self, cx: &mut Context<Self>) {
        let store = self.store.read(cx);
        let (http, path) = (store.http.clone(), format!("/api/chats/{}/consolidate", self.chat_id));
        let reload = self.store.downgrade();
        cx.spawn(async move |_, cx| {
            if let Ok(Err(e)) =
                runtime::spawn(async move { http.post::<_, serde_json::Value>(&path, &json!({})).await }).await
            {
                eprintln!("compact: {e}");
            }
            let _ = reload.update(cx, |s, cx| s.reload_chats(cx));
        })
        .detach();
    }

    /// Who the text names that isn't in the chat yet: they join it before the message goes (a chat holds 8).
    fn joining(&self, text: &str, cx: &App) -> Option<Vec<String>> {
        let store = self.store.read(cx);
        let chat = store.chat(&self.chat_id)?;
        let callable = crate::state::crew::callable(&store.agents, chat.project_id.as_deref());
        let pairs: Vec<(&str, &str)> = callable.iter().map(|a| (a.id.as_str(), a.name.as_str())).collect();
        let teams: Vec<(&str, &[String])> = crate::state::crew::teams_in(&store.teams, chat.project_id.as_deref())
            .into_iter()
            .map(|t| (t.name.as_str(), t.agent_ids.as_slice()))
            .collect();
        let mut named = crate::state::crew::to_join(text, &chat.agent_ids, &pairs, &teams);
        named.truncate(crate::state::crew::CHAT_MEMBERS_MAX.saturating_sub(chat.agent_ids.len()));
        (!named.is_empty()).then(|| chat.agent_ids.iter().cloned().chain(named).collect())
    }

    fn apply(&mut self, event: SubscribeChatItem, cx: &mut Context<Self>) {
        let snapshot = matches!(event, SubscribeChatItem::Snapshot { .. });
        let known: HashSet<String> = self.log.messages.iter().map(|m| m.id.clone()).collect();
        self.log.apply(event);
        if snapshot {
            self.loaded = true;
            // Text already written when we arrive shows at once.
            self.shown = self
                .log
                .partial
                .iter()
                .map(|(turn, text)| (turn.clone(), text.chars().count()))
                .collect();
        } else if self.loaded {
            for m in &self.log.messages {
                if !known.contains(&m.id) {
                    self.fresh.insert(m.id.clone());
                }
            }
            for turn in &self.log.turns {
                self.fresh.insert(turn.id.clone());
            }
        }
        self.shown.retain(|turn, _| self.log.partial.contains_key(turn));
        self.relayout(cx);
        self.tick(cx);
        self.drain(cx);
        cx.notify();
    }

    fn relayout(&mut self, cx: &mut Context<Self>) {
        let rows = self.rows();
        if rows == self.rows {
            // Same rows: only the live ones grew.
            let live: Vec<usize> = rows
                .iter()
                .enumerate()
                .filter(|(_, r)| matches!(r, Row::Live(_)))
                .map(|(i, _)| i)
                .collect();
            if let (Some(first), Some(last)) = (live.first(), live.last()) {
                self.scroller
                    .update(cx, |s, cx| s.remeasure_items(*first..*last + 1, cx));
            }
        } else {
            let count = rows.len();
            self.scroller.update(cx, |s, cx| s.reset(count, cx));
            self.rows = rows;
        }
    }

    fn rows(&self) -> Vec<Row> {
        let messages = (0..self.log.messages.len()).map(Row::Message);
        let live = self.log.turns.iter().map(|t| Row::Live(t.id.clone()));
        let rows: Vec<Row> = messages.chain(live).collect();
        if rows.is_empty() { vec![Row::Empty] } else { rows }
    }

    /// While a live turn's text is behind, or a turn runs (its elapsed time), keep drawing: a frame at a time while
    /// revealing, once a second otherwise. Stops when nothing moves.
    fn tick(&mut self, cx: &mut Context<Self>) {
        if self.ticking || self.log.turns.is_empty() {
            return;
        }
        self.ticking = true;
        cx.spawn(async move |this, cx| {
            loop {
                let behind = this
                    .update(cx, |this, cx| {
                        let behind = this.reveal();
                        this.relayout(cx);
                        cx.notify();
                        if this.log.turns.is_empty() && !behind {
                            this.ticking = false;
                            return None;
                        }
                        Some(behind)
                    })
                    .ok()
                    .flatten();
                let Some(behind) = behind else { return };
                let wait = if behind {
                    Duration::from_millis(16)
                } else {
                    Duration::from_secs(1)
                };
                cx.background_executor().timer(wait).await;
            }
        })
        .detach();
    }

    /// Moves every live text a step closer to what arrived; true while some is still behind.
    fn reveal(&mut self) -> bool {
        let mut behind = false;
        for (turn, text) in &self.log.partial {
            let total = text.chars().count();
            let shown = self.shown.entry(turn.clone()).or_insert(0);
            if *shown < total {
                *shown += (total - *shown).div_ceil(REVEAL_FRAMES).max(1);
                behind |= *shown < total;
            }
        }
        behind
    }

    fn busy(&self) -> bool {
        !self.log.turns.is_empty()
    }

    fn submit(&mut self, draft: Draft, window: &mut Window, cx: &mut Context<Self>) {
        if self.busy() || !self.queue.is_empty() {
            self.queue.push(draft); // sent when the chat is free
            cx.notify();
            return;
        }
        self.deliver(draft, window, cx);
    }

    fn deliver(&mut self, draft: Draft, window: &mut Window, cx: &mut Context<Self>) {
        let store = self.store.read(cx);
        let (http, rpc, chat_id) = (store.http.clone(), self.rpc.clone(), self.chat_id.clone());
        let Draft { text, files } = draft;
        let sent = text.clone();
        let join = self.joining(&text, cx);
        let task = runtime::spawn(async move {
            if let Some(agent_ids) = join {
                http.patch::<_, serde_json::Value>(&format!("/api/chats/{chat_id}"), &json!({ "agentIds": agent_ids }))
                    .await
                    .map_err(|_| t!("chat.addFailed").into_owned())?;
            }
            crate::net::send::deliver(&http, &rpc, &chat_id, &text, files).await
        });
        cx.spawn_in(window, async move |this, cx| {
            let failed = match task.await {
                Ok(Ok(())) => None,
                Ok(Err(msg)) => Some(msg),
                Err(_) => Some(t!("chat.sendFailed").into_owned()),
            };
            let _ = this.update_in(cx, |this, window, cx| match failed {
                Some(msg) => this.composer.update(cx, |c, cx| c.restore(sent, msg, window, cx)),
                None => this.store.update(cx, |s, cx| s.reload_chats(cx)), // someone may have joined
            });
        })
        .detach();
    }

    /// The chat is free: the next queued message goes.
    fn drain(&mut self, cx: &mut Context<Self>) {
        if self.busy() || self.queue.is_empty() {
            return;
        }
        let draft = self.queue.remove(0);
        let store = self.store.read(cx);
        let (http, rpc, chat_id) = (store.http.clone(), self.rpc.clone(), self.chat_id.clone());
        runtime::spawn(async move {
            if let Err(e) = crate::net::send::deliver(&http, &rpc, &chat_id, &draft.text, draft.files).await {
                eprintln!("queue: {e}");
            }
        });
    }

    fn stop(&mut self, cx: &mut Context<Self>) {
        let (rpc, chat_id) = (self.rpc.clone(), self.chat_id.clone());
        self.queue.clear();
        cx.notify();
        runtime::spawn(async move {
            if let Err(e) = rpc
                .call::<serde_json::Value>("interrupt", Some(json!({ "chatId": chat_id })))
                .await
            {
                eprintln!("interrupt: {e}");
            }
        });
    }

    fn retry(&mut self, message_id: String) {
        let (rpc, chat_id) = (self.rpc.clone(), self.chat_id.clone());
        runtime::spawn(async move {
            if let Err(e) = rpc
                .call::<serde_json::Value>("retry", Some(json!({ "chatId": chat_id, "messageId": message_id })))
                .await
            {
                eprintln!("retry: {e}");
            }
        });
    }

    fn set_model(&mut self, choice: ModelChoice, cx: &mut Context<Self>) {
        let store = self.store.read(cx);
        let (http, path) = (store.http.clone(), format!("/api/chats/{}", self.chat_id));
        let reload = self.store.downgrade();
        let body = json!({ "model": choice.model, "accountId": choice.account_id, "effort": choice.effort });
        cx.spawn(async move |_, cx| {
            if let Ok(Err(e)) =
                runtime::spawn(async move { http.patch::<_, serde_json::Value>(&path, &body).await }).await
            {
                eprintln!("model: {e}");
            }
            let _ = reload.update(cx, |s, cx| s.reload_chats(cx));
        })
        .detach();
    }

    fn copy(&mut self, id: String, text: String, cx: &mut Context<Self>) {
        cx.write_to_clipboard(ClipboardItem::new_string(text));
        self.copied = Some(id.clone());
        cx.notify();
        cx.spawn(async move |this, cx| {
            cx.background_executor().timer(Duration::from_millis(1200)).await;
            let _ = this.update(cx, |this, cx| {
                if this.copied.as_deref() == Some(&id) {
                    this.copied = None;
                    cx.notify();
                }
            });
        })
        .detach();
    }

    fn toggle(&mut self, key: String, cx: &mut Context<Self>) {
        if !self.open.remove(&key) {
            self.open.insert(key);
        }
        self.relayout_all(cx);
    }

    /// Something inside a row changed size (a fold opened): every row is measured again.
    fn relayout_all(&mut self, cx: &mut Context<Self>) {
        let count = self.rows.len();
        self.scroller.update(cx, |s, cx| s.remeasure_items(0..count, cx));
        cx.notify();
    }

    fn render_row(&mut self, ix: usize, window: &mut Window, cx: &mut Context<Self>) -> AnyElement {
        let Some(row) = self.rows.get(ix).cloned() else {
            return div().into_any_element();
        };
        let (key, body) = match row {
            Row::Empty => ("empty".to_string(), self.empty(window)),
            Row::Message(i) => {
                let m = self.log.messages[i].clone();
                let body = match m.role {
                    MessageRole::User => self.user_row(&m, window, cx),
                    _ => self.reply_row(i, &m, window, cx),
                };
                (m.id.clone(), body)
            }
            Row::Live(turn) => (turn.clone(), self.live_row(&turn, window, cx)),
        };
        let row = div()
            .w_full()
            .max_w(px(COLUMN))
            .mx_auto()
            .px(px(space::X6))
            .py(px(space::X2_5))
            .child(body);
        // New rows enter (once): a fade and a short rise.
        if self.fresh.contains(&key) {
            motion::enter(row, SharedString::from(format!("enter-{key}")), motion::ENTER_MS, 8.)
        } else {
            row.into_any_element()
        }
    }

    fn empty(&self, window: &Window) -> AnyElement {
        let p = theme::palette(window);
        if !self.loaded {
            return div().h(px(space::X14)).into_any_element();
        }
        div()
            .flex()
            .flex_col()
            .items_center()
            .gap(px(space::X1_5))
            .pt(px(space::X14))
            .child(AgentFace::new("chat-empty", 0).size(32.))
            .child(
                div()
                    .pt(px(space::X2))
                    .font_weight(FontWeight::SEMIBOLD)
                    .child(t!("chat.empty").into_owned()),
            )
            .child(
                div()
                    .max_w(px(360.))
                    .text_center()
                    .text_sm()
                    .text_color(p.text_muted)
                    .child(t!("chat.emptyHint").into_owned()),
            )
            .into_any_element()
    }

    /// Your message: a bubble on the right; copy and time show on hover.
    fn user_row(&mut self, m: &Message, window: &mut Window, cx: &mut Context<Self>) -> AnyElement {
        let p = theme::palette(window);
        let blocks = self
            .parsed
            .entry(m.id.clone())
            .or_insert_with(|| markdown::parse(&m.text));
        let text = markdown::render(&m.id, blocks, window);
        let group = SharedString::from(format!("user-{}", m.id));
        let copied = self.copied.as_deref() == Some(&m.id);
        let (id, body) = (m.id.clone(), m.text.clone());
        let files = m.attachments.iter().map(|a| {
            div()
                .flex()
                .items_center()
                .gap(px(space::X1_5))
                .h(px(tokens::CONTROL_H_SM))
                .px(px(space::X2_5))
                .rounded_full()
                .bg(p.bg_control)
                .text_size(px(12.5))
                .text_color(p.text_secondary)
                .child(icon(IconName::File, icon::XS))
                .child(div().max_w(px(200.)).truncate().child(a.name.clone()))
        });
        div()
            .group(group.clone())
            .flex()
            .flex_col()
            .items_end()
            .gap(px(space::X1_5))
            .child(
                div()
                    .max_w(px(500.))
                    .px(px(space::X3))
                    .py(px(space::X2_5))
                    .rounded_tl(px(tokens::RADIUS_CARD))
                    .rounded_tr(px(tokens::RADIUS_CARD))
                    .rounded_bl(px(tokens::RADIUS_CARD))
                    .rounded_br(px(space::X1_5))
                    .bg(p.bg_raised)
                    .border_1()
                    .border_color(p.border)
                    .child(text),
            )
            .when(!m.attachments.is_empty(), |c| {
                c.child(
                    div()
                        .flex()
                        .flex_wrap()
                        .justify_end()
                        .gap(px(space::X1_5))
                        .children(files),
                )
            })
            .child(
                div()
                    .flex()
                    .items_center()
                    .gap(px(space::X1))
                    .opacity(0.)
                    .group_hover(group, |s| s.opacity(1.))
                    .child(div().text_xs().text_color(p.text_dim).child(format::time(
                        m.at,
                        format::now_ms(),
                        format::lang(),
                    )))
                    .child(
                        Button::icon_only(
                            SharedString::from(format!("copy-{}", m.id)),
                            if copied { IconName::Check } else { IconName::Copy },
                            if copied { t!("common.copied") } else { t!("common.copy") }.into_owned(),
                        )
                        .size(Size::Xs)
                        .on_click(cx.listener(move |this, _, _, cx| this.copy(id.clone(), body.clone(), cx))),
                    ),
            )
            .into_any_element()
    }

    /// A finished reply: who (unless solo or continuing), its text and steps as they happened, how it ended.
    fn reply_row(&mut self, i: usize, m: &Message, window: &mut Window, cx: &mut Context<Self>) -> AnyElement {
        let p = theme::palette(window);
        let (bare, continued) = self.voice(i, m, cx);
        let last = i + 1 == self.log.messages.len() && !self.busy();
        let mut column: Vec<AnyElement> = Vec::new();

        // The text cut where steps began; the long thoughts go on top of the first group.
        let work: Vec<Step> = m
            .steps
            .iter()
            .filter(|s| s.tool != "thought" && s.tool != "reply")
            .cloned()
            .collect();
        let thoughts: Vec<Step> = m.steps.iter().filter(|s| s.tool == "thought").cloned().collect();
        let pieces = steps::interleave(&m.text, &work, |s| s.at.map(|a| a.max(0.) as usize));
        let groups = pieces.iter().filter(|p| matches!(p, Piece::Steps(_))).count();
        let mut first = true;
        for (n, piece) in pieces.into_iter().enumerate() {
            match piece {
                Piece::Text(text) => {
                    let key = format!("{}-t{n}", m.id);
                    let blocks = self.parsed.entry(key.clone()).or_insert_with(|| markdown::parse(&text));
                    column.push(markdown::render(&key, blocks, window).into_any_element());
                }
                Piece::Steps(group) => {
                    let mut all = if first { thoughts.clone() } else { Vec::new() };
                    all.extend(group);
                    first = false;
                    let took = if groups == 1 {
                        m.duration_ms
                    } else {
                        Some(all.iter().filter_map(|s| s.ms).sum())
                    };
                    column.push(self.activity(&format!("{}-g{n}", m.id), &all, took, window, cx));
                }
            }
        }

        // How it ended: a warning line, or the failure with its error.
        if let Some((tone, text)) = steps::ending(m.error.as_deref()) {
            column.push(match tone {
                Tone::Warning => div().text_sm().text_color(p.warning).child(text).into_any_element(),
                Tone::Danger => div()
                    .flex()
                    .flex_col()
                    .gap(px(space::X1_5))
                    .child(
                        div()
                            .text_sm()
                            .font_weight(FontWeight::MEDIUM)
                            .text_color(p.danger)
                            .child(t!("chat.failed").into_owned()),
                    )
                    .child(
                        div()
                            .px(px(space::X3))
                            .py(px(space::X2))
                            .rounded(px(tokens::RADIUS_CONTROL))
                            .bg(p.bg_code)
                            .font_family(MONO)
                            .text_sm()
                            .text_color(p.danger)
                            .child(text),
                    )
                    .into_any_element(),
            });
            if last && m.error.as_deref() != Some("monthly_limit") {
                let id = m.id.clone();
                let label = if m.error.as_deref() == Some("reply_limit") {
                    "chat.continue"
                } else {
                    "chat.retry"
                };
                column.push(
                    div()
                        .child(
                            Button::new(SharedString::from(format!("retry-{}", m.id)), t!(label).into_owned())
                                .icon(IconName::RefreshCw)
                                .size(Size::Sm)
                                .on_click(cx.listener(move |this, _, _, _| this.retry(id.clone()))),
                        )
                        .into_any_element(),
                );
            }
        }

        let store = self.store.read(cx);
        let tone = store.tone(m.agent_id.as_deref());
        let name = store.agent_name(m.agent_id.as_deref());
        let hue = face::hue(p, tone);
        let model = m
            .model
            .as_deref()
            .map(|id| crate::labels::model_name(id, &store.models));
        reply_frame(
            &m.id,
            (!bare && !continued).then_some((tone, name, hue, model)),
            bare,
            FaceState::Idle,
            column,
            p,
        )
    }

    /// Solo chats are bare; a reply continues the previous when the same agent answers within 5 minutes.
    fn voice(&self, i: usize, m: &Message, cx: &App) -> (bool, bool) {
        let bare = self
            .store
            .read(cx)
            .chat(&self.chat_id)
            .is_none_or(|c| c.agent_ids.len() <= 1);
        let continued = i > 0 && {
            let prev = &self.log.messages[i - 1];
            matches!(prev.role, MessageRole::Assistant)
                && prev.agent_id == m.agent_id
                && m.at - prev.at < CONTINUES_MS
                && m.switches.is_empty()
        };
        (bare, continued)
    }

    /// One folded line of work ("Read 2 files and ran 3 commands · 1 failed · 12s") that opens to its steps.
    fn activity(
        &mut self,
        key: &str,
        all: &[Step],
        took: Option<f64>,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> AnyElement {
        let p = theme::palette(window);
        let summed: Vec<Summed> = all
            .iter()
            .map(|s| Summed {
                kind: &s.tool,
                status: status_of(&s.status),
                detail: s.detail.as_deref().filter(|d| !d.is_empty()).unwrap_or(&s.args),
                files: if s.tool == "edit" {
                    s.args.split(", ").filter(|f| !f.is_empty()).collect()
                } else {
                    Vec::new()
                },
            })
            .collect();
        let summary = steps::summarize(&summed);
        let open = self.open.contains(key);
        let shown: Vec<&Step> = all
            .iter()
            .filter(|s| s.tool != "thought" || s.ms.unwrap_or(0.) >= 1000.)
            .collect();
        let l = format::lang();
        let head_key = key.to_string();
        let mut head = fold_head(key, open, window, cx)
            .on_click(cx.listener(move |this, _, _, cx| this.toggle(head_key.clone(), cx)))
            .child(div().truncate().child(steps::sentence(&summary)));
        if summary.failed > 0 {
            head = head.child(
                div()
                    .flex_none()
                    .text_color(p.danger)
                    .child(format!("· {}", tn("activity.errors", summary.failed as i64))),
            );
        }
        if summary.refused > 0 {
            head = head.child(
                div()
                    .flex_none()
                    .text_color(p.warning)
                    .child(format!("· {}", tn("activity.refused", summary.refused as i64))),
            );
        }
        if let Some(ms) = took.filter(|ms| *ms >= 1000.) {
            head = head.child(
                div()
                    .flex_none()
                    .text_color(p.text_dim)
                    .child(format!("· {}", format::duration(ms, l))),
            );
        }
        let list = open.then(|| {
            let rows: Vec<AnyElement> = shown
                .iter()
                .enumerate()
                .map(|(n, s)| {
                    if s.tool == "thought" {
                        step_line(
                            &format!("{key}-{n}"),
                            IconName::Brain,
                            p.text_muted,
                            t!("activity.thought", time = format::duration(s.ms.unwrap_or(0.), l)).into_owned(),
                            None,
                            p,
                        )
                        .into_any_element()
                    } else {
                        self.stored_step(&format!("{key}-{n}"), s, window, cx)
                    }
                })
                .collect();
            motion::enter(
                div()
                    .flex()
                    .flex_col()
                    .gap(px(space::X0_5))
                    .pl(px(space::X1))
                    .border_l_1()
                    .border_color(p.border)
                    .ml(px(space::X1_5))
                    .children(rows),
                SharedString::from(format!("fold-{key}")),
                motion::MENU_IN_MS,
                4.,
            )
        });
        div()
            .flex()
            .flex_col()
            .gap(px(space::X1))
            .child(head)
            .children(list)
            .into_any_element()
    }

    /// One finished step: what it was, failed/refused/how long; it opens to its command and the start of its output.
    fn stored_step(&mut self, key: &str, s: &Step, window: &mut Window, cx: &mut Context<Self>) -> AnyElement {
        let p = theme::palette(window);
        let title = s
            .title
            .clone()
            .filter(|t| !t.is_empty())
            .unwrap_or_else(|| match s.tool.as_str() {
                "run" => format!("$ {}", s.args),
                "read" | "search" => format!("{} {}", s.tool, s.args),
                "edit" => s.args.clone(),
                other => other.to_string(),
            });
        let command = if s.tool == "run" {
            s.args.clone()
        } else {
            s.detail.clone().unwrap_or_default()
        };
        let (color, fact) = match s.status {
            StepStatus::Error => (p.danger, Some(t!("activity.failedStep").into_owned())),
            StepStatus::Refused => (p.warning, Some(t!("activity.refusedStep").into_owned())),
            _ => (
                p.text_secondary,
                s.ms.filter(|ms| *ms >= 1000.)
                    .map(|ms| format::duration(ms, format::lang())),
            ),
        };
        let can_open = !command.is_empty() || !s.result.is_empty();
        let open = self.open.contains(key);
        let line_key = key.to_string();
        let line = step_line(key, glyph_of(&s.tool), color, title, fact, p).when(can_open, |l| {
            l.cursor_pointer()
                .on_click(cx.listener(move |this, _, _, cx| this.toggle(line_key.clone(), cx)))
        });
        let detail = (open && can_open).then(|| {
            let result: String = s.result.lines().take(3).collect::<Vec<_>>().join("\n");
            motion::enter(
                div()
                    .flex()
                    .flex_col()
                    .gap(px(space::X1))
                    .pl(px(space::X6))
                    .when(!command.is_empty(), |c| {
                        c.child(code_box(command.clone(), p.text_secondary, p))
                    })
                    .when(!result.is_empty(), |c| c.child(code_box(result, p.text_muted, p))),
                SharedString::from(format!("step-{key}")),
                motion::MENU_IN_MS,
                4.,
            )
        });
        div()
            .flex()
            .flex_col()
            .gap(px(space::X1))
            .child(line)
            .children(detail)
            .into_any_element()
    }

    /// A turn in progress: its steps as they come, the text revealed smoothly, and a status line.
    fn live_row(&mut self, turn_id: &str, window: &mut Window, cx: &mut Context<Self>) -> AnyElement {
        let p = theme::palette(window);
        let turn = self.log.turns.iter().find(|t| t.id == turn_id).cloned();
        let agent = turn.as_ref().and_then(|t| t.agent_id.clone());
        let text: String = self
            .log
            .partial
            .get(turn_id)
            .map(|t| t.chars().take(*self.shown.get(turn_id).unwrap_or(&0)).collect())
            .unwrap_or_default();
        let live_steps: Vec<WorkStep> = self
            .log
            .steps
            .iter()
            .filter(|s| s.turn_id == turn_id)
            .cloned()
            .collect();
        let mut column: Vec<AnyElement> = Vec::new();
        if !live_steps.is_empty() {
            column.push(
                div()
                    .flex()
                    .flex_col()
                    .gap(px(space::X0_5))
                    .children(live_steps.iter().map(|s| {
                        let running = matches!(s.status, WorkStepStatus::Running | WorkStepStatus::Waiting);
                        let color = match s.status {
                            WorkStepStatus::Error => p.danger,
                            WorkStepStatus::Refused => p.warning,
                            _ => p.text_secondary,
                        };
                        let mark: AnyElement = if running {
                            WorkingRing::new(SharedString::from(format!("live-step-{}", s.id)))
                                .size(icon::XS)
                                .into_any_element()
                        } else {
                            icon(glyph_of(&kind_key(s)), icon::XS)
                                .text_color(color)
                                .into_any_element()
                        };
                        motion::enter(
                            div()
                                .flex()
                                .items_center()
                                .gap(px(space::X2))
                                .min_h(px(tokens::CONTROL_H_SM))
                                .text_sm()
                                .text_color(color)
                                .child(div().flex_none().w(px(icon::MD)).flex().justify_center().child(mark))
                                .child(div().truncate().child(s.title.clone())),
                            SharedString::from(format!("live-step-in-{}", s.id)),
                            motion::ENTER_MS,
                            4.,
                        )
                    }))
                    .into_any_element(),
            );
        }
        if !text.is_empty() {
            let blocks = markdown::parse(&text);
            column.push(markdown::render(turn_id, &blocks, window).into_any_element());
        }
        // What it does now, breathing; how long once past 5s.
        let waiting = self.log.approvals.iter().any(|a| a.turn_id.as_deref() == Some(turn_id));
        let label = match live_steps
            .iter()
            .rev()
            .find(|s| matches!(s.status, WorkStepStatus::Running))
        {
            Some(step) => step.title.clone(),
            None if waiting => t!("activity.waiting").into_owned(),
            None => t!("activity.working").into_owned(),
        };
        let started = turn.as_ref().and_then(|t| t.started_at);
        let elapsed = started
            .map(|at| format::now_ms() - at)
            .filter(|ms| *ms >= 5000. && !waiting)
            .map(|ms| format::duration(ms, format::lang()));
        column.push(
            div()
                .flex()
                .items_center()
                .gap(px(space::X2))
                .text_sm()
                .text_color(if waiting { p.warning } else { p.text_muted })
                .child(WorkingRing::new(SharedString::from(format!("live-ring-{turn_id}"))).size(icon::SM))
                .child(
                    div().truncate().child(label).with_animation(
                        SharedString::from(format!("breathe-{turn_id}")),
                        Animation::new(Duration::from_millis(1600))
                            .repeat()
                            .with_easing(pulsating_between(0.55, 1.)),
                        |el, t| el.opacity(t),
                    ),
                )
                .when_some(elapsed, |r, e| {
                    r.child(div().flex_none().text_color(p.text_dim).child(format!("· {e}")))
                })
                .into_any_element(),
        );
        let store = self.store.read(cx);
        let tone = store.tone(agent.as_deref());
        let name = store.agent_name(agent.as_deref());
        let bare = store.chat(&self.chat_id).is_none_or(|c| c.agent_ids.len() <= 1);
        reply_frame(
            turn_id,
            (!bare).then_some((tone, name, face::hue(p, tone), None)),
            bare,
            FaceState::Working,
            column,
            p,
        )
    }

    /// What waits above the box: approvals and questions of this chat, the queue, and Stop while a reply runs.
    fn bottom(&mut self, window: &mut Window, cx: &mut Context<Self>) -> Div {
        let p = theme::palette(window);
        let approvals = self.log.approvals.clone();
        let mut cards: Vec<AnyElement> = Vec::new();
        for a in &approvals {
            let answer = approval::is_question(a).then(|| {
                self.answers
                    .entry(a.id.clone())
                    .or_insert_with(|| {
                        cx.new(|cx| {
                            let mut state =
                                TextareaState::new(window, cx).placeholder(t!("question.placeholder").into_owned());
                            state.set_auto_grow(2, 6, cx);
                            state
                        })
                    })
                    .clone()
            });
            let store = self.store.clone();
            let decide: approval::Decide = Rc::new(move |id, outcome, reason, _, cx| {
                store.update(cx, |s, cx| s.decide(id, outcome, reason, cx));
            });
            let open: approval::OpenChat = Rc::new(|_, _, _| {});
            cards.push(motion::enter(
                approval::card(a, self.store.read(cx), answer.as_ref(), decide, open, window),
                SharedString::from(format!("tray-{}", a.id)),
                motion::ENTER_MS,
                8.,
            ));
        }
        let queue = (!self.queue.is_empty()).then(|| {
            div()
                .flex()
                .flex_col()
                .gap(px(space::X1))
                .px(px(space::X3))
                .py(px(space::X2))
                .rounded(px(tokens::RADIUS_CARD))
                .border_1()
                .border_color(p.border)
                .bg(p.bg_surface)
                .child(
                    div()
                        .text_sm()
                        .text_color(p.text_muted)
                        .child(t!("queue.label").into_owned()),
                )
                .children(self.queue.iter().enumerate().map(|(n, d)| {
                    div()
                        .flex()
                        .items_center()
                        .gap(px(space::X2))
                        .child(div().flex_1().truncate().child(d.text.clone()))
                        .child(
                            Button::icon_only(
                                SharedString::from(format!("queue-remove-{n}")),
                                IconName::Close,
                                t!("queue.remove").into_owned(),
                            )
                            .size(Size::Xs)
                            .on_click(cx.listener(move |this, _, _, cx| {
                                if n < this.queue.len() {
                                    this.queue.remove(n);
                                    cx.notify();
                                }
                            })),
                        )
                }))
        });
        let stop = self.busy().then(|| {
            motion::enter(
                div().flex().justify_center().child(
                    Button::new("chat-stop", t!("composer.stop").into_owned())
                        .icon(IconName::Pause)
                        .variant(Variant::Secondary)
                        .size(Size::Sm)
                        .round()
                        .on_click(cx.listener(|this, _, _, cx| this.stop(cx))),
                ),
                "chat-stop-in",
                motion::ENTER_MS,
                6.,
            )
        });
        div()
            .flex()
            .flex_col()
            .gap(px(space::X2))
            .w_full()
            .max_w(px(COLUMN))
            .mx_auto()
            .px(px(space::X6))
            .pb(px(space::X4))
            .children(cards)
            .children(queue)
            .children(stop)
            .child(self.composer.clone())
    }
}

impl Render for ChatScreen {
    fn render(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        crate::hot::call(|| self.view(window, cx))
    }
}

impl ChatScreen {
    // The render body, behind Subsecond's reload point (crate::hot).
    fn view(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement + use<> {
        let p = theme::palette(window);
        // The picker shows the chat's own model.
        if let Some(chat) = self.store.read(cx).chat(&self.chat_id) {
            let choice = ModelChoice {
                model: chat.model.clone(),
                account_id: chat.account_id.clone(),
                effort: chat.effort.map(|e| e.to_string()),
            };
            self.model.update(cx, |m, cx| m.set_value(choice, cx));
        }
        let bottom = self.bottom(window, cx);
        div()
            .flex()
            .flex_col()
            .size_full()
            .bg(p.bg_canvas)
            .child(
                MessageScroller::new(
                    SharedString::from(format!("chat-{}", self.chat_id)),
                    self.scroller.clone(),
                    cx.processor(|this, ix, window, cx| this.render_row(ix, window, cx)),
                )
                .flex_1(),
            )
            .child(bottom)
    }
}

/// A reply's frame: the face (and name, in the agent's hue; the model on hover) on the left, then its column.
fn reply_frame(
    key: &str,
    who: Option<(usize, String, Rgba, Option<String>)>,
    bare: bool,
    state: FaceState,
    column: Vec<AnyElement>,
    p: &Palette,
) -> AnyElement {
    let face = who.as_ref().map(|(tone, _, _, _)| {
        AgentFace::new(SharedString::from(format!("face-{key}")), *tone)
            .size(28.)
            .state(state)
    });
    div()
        .flex()
        .gap(px(space::X3))
        .when(!bare, |r| {
            r.child(div().flex_none().w(px(28.)).pt(px(space::X0_5)).children(face))
        })
        .child(
            div()
                .flex()
                .flex_col()
                .flex_1()
                .min_w_0()
                .gap(px(space::X2))
                .when_some(who, |c, (_, name, hue, model)| {
                    c.child(
                        div()
                            .flex()
                            .items_baseline()
                            .gap(px(space::X2))
                            .child(div().font_weight(FontWeight::SEMIBOLD).text_color(hue).child(name))
                            .when_some(model, |r, m| r.child(div().text_xs().text_color(p.text_dim).child(m))),
                    )
                })
                .children(column),
        )
        .into_any_element()
}

/// A fold's head: a chevron that turns (spring) and what's inside, muted until hovered.
fn fold_head(key: &str, open: bool, window: &mut Window, cx: &mut App) -> Stateful<Div> {
    let p = theme::palette(window);
    let id = ElementId::from(SharedString::from(format!("fold-head-{key}")));
    let pointer = motion::pointer(&id, window, cx);
    let hovered = pointer.read(cx).hovered;
    let fg = motion::color(
        &id,
        "fg",
        if hovered || open { p.text } else { p.text_muted },
        window,
        cx,
    );
    let turn = gpui_kit::base::spring(
        SharedString::from(format!("fold-turn-{key}")),
        px(if open { 0. } else { -90. }),
        motion::settle(motion::SETTLE_MS),
        window,
        cx,
    );
    let head = div()
        .id(id)
        .role(Role::Button)
        .aria_expanded(open)
        .flex()
        .items_center()
        .gap(px(space::X1_5))
        .min_h(px(tokens::CONTROL_H_SM))
        .text_sm()
        .text_color(fg)
        .cursor_pointer()
        .child(
            icon(IconName::ChevronDown, icon::XS)
                .text_color(fg)
                .rotate(radians(f32::from(turn).to_radians())),
        );
    motion::track(head, &pointer)
}

fn step_line(
    key: &str,
    glyph: IconName,
    color: Rgba,
    title: String,
    fact: Option<String>,
    p: &Palette,
) -> Stateful<Div> {
    div()
        .id(SharedString::from(format!("step-line-{key}")))
        .flex()
        .items_center()
        .gap(px(space::X2))
        .min_h(px(tokens::CONTROL_H_SM))
        .text_sm()
        .text_color(color)
        .child(
            div()
                .flex_none()
                .w(px(icon::MD))
                .flex()
                .justify_center()
                .child(icon(glyph, icon::XS)),
        )
        .child(div().flex_1().min_w_0().truncate().child(title))
        .when_some(fact, |r, f| r.child(div().flex_none().text_color(p.text_dim).child(f)))
}

fn code_box(text: String, color: Rgba, p: &Palette) -> Div {
    div()
        .px(px(space::X2_5))
        .py(px(space::X1_5))
        .rounded(px(tokens::RADIUS_CONTROL))
        .bg(p.bg_code)
        .font_family(MONO)
        .text_sm()
        .text_color(color)
        .child(text)
}

/// A step's glyph says what kind of work it was.
fn glyph_of(tool: &str) -> IconName {
    match steps::kind_of(tool) {
        Some(steps::Kind::Search) => IconName::Search,
        Some(steps::Kind::Read) => IconName::FileText,
        Some(steps::Kind::Edit) => IconName::Pencil,
        Some(steps::Kind::Run) => IconName::SquareTerminal,
        Some(steps::Kind::Delegate) => IconName::Users,
        _ => IconName::Wrench,
    }
}

fn kind_key(s: &WorkStep) -> String {
    serde_json::to_value(s.kind)
        .ok()
        .and_then(|v| v.as_str().map(str::to_string))
        .unwrap_or_else(|| "tool".into())
}

fn status_of(s: &StepStatus) -> &'static str {
    match s {
        StepStatus::Error => "error",
        StepStatus::Refused => "refused",
        StepStatus::Ok => "ok",
    }
}
