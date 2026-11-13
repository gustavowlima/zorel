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
// This file holds the screen itself (its state, the event stream, the rows, the composer's area, the layout); each part
// it draws lives in screens/chat/: builder (create agents), send (submit, queue, stop, model), history (your messages,
// rewind, undo), reply, live (the reply being written), work (steps), receipt (an approval's outcome), and the side
// panel with its tabs (side, files, git), the crew drawer, access, context and attachments.
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

mod access;
mod attachments;
mod builder;
mod context;
mod crew;
mod files;
mod git;
mod history;
mod live;
mod receipt;
mod reply;
mod send;
pub mod side;
mod work;

use self::{reply::*, work::*};

use crate::state::remote::Remote;
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
        face::{self, AgentFace, FaceState},
        icon::{self, icon},
        loader::Loader,
        markdown::{self, Block},
        motion,
        shimmer::shimmer,
        space, step_tree,
    },
};

/// The timeline's column (prototype: a comfortable reading width).
/// The conversation's column: wide enough to use a big window, still a comfortable line; narrower windows wrap.
const COLUMN: f32 = 920.;
/// A reply continues the previous one (no face, no name) when the same agent answers within this.
const CONTINUES_MS: f64 = 5. * 60. * 1000.;
/// Frames a revealed delta takes to show (the web's ~6).
const REVEAL_FRAMES: usize = 6;

pub enum ChatEvent {
    Navigate(crate::route::Route),
    /// Start a chat with an agent (the Builder's "made" list).
    ChatWith(String),
}

impl EventEmitter<ChatEvent> for ChatScreen {}

/// What a list row shows.
#[derive(Clone, PartialEq)]
enum Row {
    Message(usize),
    /// A note between messages (state/chat.rs › Note), by index.
    Note(usize),
    Live(String),
    Empty,
    /// The Builder's chat: its intro before the first message, its proposal, the agents it made.
    Intro,
    Proposal,
    Creating,
    Created,
}

/// A chat with the Builder (spec 018): what was edited on its proposal before Create, and whether Create is on its way.
#[derive(Default)]
struct BuilderMode {
    edits: Vec<crate::screens::proposal::Edit>,
    editing: Option<usize>,
    pickers: HashMap<usize, Entity<ModelPicker>>,
    busy: bool,
    /// The proposal these edits belong to (a new one starts from what the Builder proposed).
    approval: Option<String>,
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
    /// Why undoing a turn failed (a conflict lists the files), by turn.
    undo_errors: HashMap<String, String>,
    model: Entity<ModelPicker>,
    /// Messages written while a reply runs: sent one at a time when the chat is idle.
    queue: Vec<Draft>,
    /// The queue's head is on its way (the next waits for it, so two never leave at once).
    draining: bool,
    /// What "Send now" did (an i18n key), shown for a few seconds.
    sent: Option<&'static str>,
    answers: HashMap<String, Entity<TextareaState>>,
    /// Set when this is a conversation with the Builder.
    builder: Option<BuilderMode>,
    /// The crew drawer (who is in the chat and what each does), and the agents whose card is open in it.
    crew_agent: Option<String>,
    /// Attachments' pictures by id, and the one open in the viewer.
    images: HashMap<String, Remote<std::sync::Arc<Image>>>,
    viewing: Option<crate::net::types::Attachment>,
    /// The side panel (screens/chat/side.rs) while open, the turns' diffs fetched so far, its width and a drag of it.
    side: Option<side::Side>,
    files: files::Files,
    git: git::Git,
    /// The Terminal tab's shells (alive while the chat is open) and the one shown.
    shells: Vec<Entity<crate::screens::terminal::Shell>>,
    shell_at: usize,
    browser: Option<Entity<crate::screens::browser::Browser>>,
    diffs: HashMap<String, Remote<Rc<side::TurnDiff>>>,
    side_width: f32,
    resizing: Option<(f32, f32)>,
    /// How full the next turn's context is (screens/chat/context.rs), read on open and after each turn.
    context: Option<crate::net::types::ContextUsage>,
    _subscriptions: Vec<Subscription>,
}

impl ChatScreen {
    pub fn new(chat_id: String, store: Entity<Store>, window: &mut Window, cx: &mut Context<Self>) -> Self {
        let rpc = store.read(cx).rpc.clone();
        // One row from the start: the placeholder (`rows: vec![Row::Empty]` below) until the history arrives.
        let scroller = cx.new(|cx| MessageScrollerState::new(1, cx));
        let view = cx.entity().downgrade();
        let composer = cx.new(|cx| {
            let on_submit: crate::screens::composer::OnSubmit = Rc::new(move |draft, window, cx| {
                let _ = view.update(cx, |this, cx| this.submit(draft, window, cx));
            });
            Composer::new(t!("composer.placeholder").into_owned(), false, on_submit, window, cx)
        });
        let view = cx.entity().downgrade();
        let on_change: crate::screens::model_picker::OnChange = Rc::new(move |choice, _, cx| {
            let _ = view.update(cx, |this, cx| this.set_model(choice, cx));
        });
        let model = cx.new(|cx| ModelPicker::new(store.clone(), true, on_change, window, cx));
        // Beside Send: the model, and Stop while a reply runs (the web's composer).
        let (tools, chat) = (model.clone(), cx.entity().downgrade());
        composer.update(cx, |c, _| {
            c.set_tools(Rc::new(move |window, cx| {
                let busy = chat
                    .upgrade()
                    .is_some_and(|v| v.read(cx).busy() && v.read(cx).proposal().is_none());
                let usage = chat.upgrade().and_then(|v| v.read(cx).context.clone());
                let meter = context::meter(chat.clone(), usage, window);
                let level = chat.upgrade().and_then(|v| {
                    let v = v.read(cx);
                    v.store.read(cx).chat(&v.chat_id).and_then(|c| c.access)
                });
                let access = access::chip(chat.clone(), level);
                let chat = chat.clone();
                div()
                    .flex()
                    .items_center()
                    .gap(px(space::X1))
                    .child(access)
                    .child(meter)
                    .child(tools.clone())
                    .when(busy, |r| {
                        r.child(
                            Button::stop("composer-stop", t!("composer.stop").into_owned())
                                .variant(Variant::Secondary)
                                .on_click(move |_, _, cx| {
                                    let _ = chat.update(cx, |this, cx| this.stop(cx));
                                }),
                        )
                    })
                    .into_any_element()
            }))
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
            // Names, hues, the chat's model; the empty chat's hint follows who is in it (its height too).
            cx.observe(&store, |this, _, cx| {
                if this.rows == [Row::Empty] {
                    this.relayout_all(cx);
                } else {
                    cx.notify();
                }
            }),
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
            undo_errors: HashMap::new(),
            model,
            queue: Vec::new(),
            draining: false,
            sent: None,
            answers: HashMap::new(),
            builder: None,
            crew_agent: None,
            images: HashMap::new(),
            viewing: None,
            side: None,
            files: files::Files::default(),
            git: git::Git::default(),
            shells: Vec::new(),
            shell_at: 0,
            browser: None,
            diffs: HashMap::new(),
            side_width: Self::initial_side_width(cx),
            resizing: None,
            context: None,
            _subscriptions: subscriptions,
        }
    }

    fn apply(&mut self, event: SubscribeChatItem, cx: &mut Context<Self>) {
        let snapshot = matches!(event, SubscribeChatItem::Snapshot { .. });
        // The context changes with each turn: read it when we arrive and when a turn ends.
        let ended = matches!(
            event,
            SubscribeChatItem::Snapshot { .. }
                | SubscribeChatItem::TurnCompleted { .. }
                | SubscribeChatItem::TurnFailed { .. }
                | SubscribeChatItem::Interrupted { .. }
        );
        let known: HashSet<String> = self.log.messages.iter().map(|m| m.id.clone()).collect();
        self.log.apply(event);
        if ended {
            self.load_context(cx);
        }
        // A decision made: "Creating" lasts until the Builder's turn ends, not for good.
        if let Some(mode) = &mut self.builder
            && mode.busy
            && self.log.turns.is_empty()
        {
            mode.busy = false;
        }
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
        // The history arrived: rows drawn while loading (the empty chat's placeholder) change height with the same
        // identity, so measure them again.
        if snapshot {
            self.relayout_all(cx);
        }
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
        // Messages and notes in time order, then the turns running now.
        let mut timed: Vec<(f64, Row)> = self
            .log
            .messages
            .iter()
            .enumerate()
            .map(|(i, m)| (m.at, Row::Message(i)))
            .chain(self.log.notes.iter().enumerate().map(|(i, n)| (n.at(), Row::Note(i))))
            .collect();
        timed.sort_by(|a, b| a.0.total_cmp(&b.0));
        let live = self.log.turns.iter().map(|t| Row::Live(t.id.clone()));
        let mut rows: Vec<Row> = timed.into_iter().map(|(_, r)| r).chain(live).collect();
        if let Some(mode) = &self.builder {
            if rows.is_empty() {
                return vec![Row::Intro];
            }
            if self.proposal().is_some() {
                rows.push(Row::Proposal);
            } else if mode.busy {
                rows.push(Row::Creating);
            } else {
                rows.push(Row::Created);
            }
            return rows;
        }
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
            Row::Empty => ("empty".to_string(), self.empty(window, cx)),
            Row::Intro => {
                let store = self.store.read(cx);
                let builder = store
                    .chat(&self.chat_id)
                    .and_then(|c| c.agent_ids.first())
                    .and_then(|id| store.agent(id))
                    .cloned();
                let tone = store.tone(builder.as_ref().map(|b| b.id.as_str()));
                let view = cx.entity().downgrade();
                let pick: crate::screens::proposal::Pick = Rc::new(move |text, window, cx| {
                    let _ = view.update(cx, |this, cx| {
                        this.submit(
                            Draft {
                                text,
                                files: Vec::new(),
                            },
                            window,
                            cx,
                        )
                    });
                });
                (
                    "intro".to_string(),
                    crate::screens::proposal::intro(builder.as_ref(), tone, pick, window),
                )
            }
            Row::Proposal => ("proposal".to_string(), self.proposal_row(window, cx)),
            Row::Creating => ("creating".to_string(), crate::screens::proposal::creating(window)),
            Row::Created => {
                let made = self.made(cx);
                if made.is_empty() {
                    ("created".to_string(), div().into_any_element())
                } else {
                    let view = cx.entity().downgrade();
                    let open: crate::screens::proposal::Pick = Rc::new(move |id, _, cx| {
                        let _ = view.update(cx, |_, cx| cx.emit(ChatEvent::ChatWith(id)));
                    });
                    (
                        "created".to_string(),
                        crate::screens::proposal::created(&made, open, window),
                    )
                }
            }
            Row::Message(i) => {
                let m = self.log.messages[i].clone();
                let body = match m.role {
                    MessageRole::User => self.user_row(&m, window, cx),
                    _ => self.reply_row(i, &m, window, cx),
                };
                (m.id.clone(), body)
            }
            Row::Live(turn) => (turn.clone(), self.live_row(&turn, window, cx)),
            Row::Note(i) => {
                let text = self.note_text(i, cx);
                (format!("note-{i}"), separator(text, window))
            }
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

    fn empty(&self, window: &Window, cx: &App) -> AnyElement {
        let p = theme::palette(window);
        if !self.loaded {
            return div().h(px(space::X14)).into_any_element();
        }
        // With several agents: how to pick who answers.
        let several = self
            .store
            .read(cx)
            .chat(&self.chat_id)
            .is_some_and(|c| c.agent_ids.len() > 1);
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
            .when(several, |c| {
                c.child(
                    div()
                        .max_w(px(360.))
                        .text_center()
                        .text_sm()
                        .text_color(p.text_dim)
                        .child(t!("team.mentionHint").into_owned()),
                )
            })
            .into_any_element()
    }

    /// What waits above the box: approvals and questions of this chat and the queue (Stop is in the reply and the box).
    fn bottom(&mut self, window: &mut Window, cx: &mut Context<Self>) -> Div {
        let p = theme::palette(window);
        // The Builder's proposal is its card in the timeline, not a second card here.
        let approvals: Vec<_> = self
            .log
            .approvals
            .iter()
            .filter(|a| self.builder.is_none() || a.tool != "zorel_create_agent")
            .cloned()
            .collect();
        let mut cards: Vec<AnyElement> = Vec::new();
        for a in &approvals {
            let answer = approval::is_question(a).then(|| {
                self.answers
                    .entry(a.id.clone())
                    .or_insert_with(|| {
                        cx.new(|cx| {
                            let mut state =
                                TextareaState::new(window, cx).placeholder(t!("question.placeholder").into_owned());
                            state.set_auto_grow(1, 6, cx);
                            state
                        })
                    })
                    .clone()
            });
            let store = self.store.clone();
            let decide: approval::Decide = Rc::new(move |id, outcome, reason, _, cx| {
                store.update(cx, |s, cx| s.decide(id, outcome, reason, cx));
            });
            // Inside its chat: no chat name, no "Open the chat".
            cards.push(motion::enter(
                approval::card(a, self.store.read(cx), answer.as_ref(), decide, None, window),
                SharedString::from(format!("tray-{}", a.id)),
                motion::ENTER_MS,
                8.,
            ));
        }
        // The queue (the web's QueuePanel): how many replies are ahead, then each message with Send now (while a
        // reply runs), Edit (back to the box) and Remove.
        let busy = self.busy();
        let ahead = self.log.turns.len();
        let rows: Vec<AnyElement> = self
            .queue
            .iter()
            .enumerate()
            .map(|(n, d)| {
                let joins = self.joins_turn(d, cx);
                let text = d.text.clone();
                div()
                    .flex()
                    .items_center()
                    .gap(px(space::X2))
                    .min_h(px(tokens::CONTROL_H))
                    .py(px(space::X1))
                    .when(n > 0, |r| r.border_t_1().border_color(p.border))
                    .child(icon(IconName::CornerDownRight, icon::MD).text_color(p.text_muted))
                    .child(
                        div()
                            .flex_1()
                            .min_w_0()
                            .truncate()
                            .text_color(p.text_secondary)
                            .child(d.text.clone()),
                    )
                    .when(busy, |r| {
                        r.child(
                            Button::new(
                                SharedString::from(format!("queue-now-{n}")),
                                t!("queue.sendNow").into_owned(),
                            )
                            .icon(IconName::CornerDownRight)
                            .variant(Variant::Ghost)
                            .size(Size::Sm)
                            .tooltip(
                                if joins {
                                    t!("queue.sendNowJoin")
                                } else {
                                    t!("queue.sendNowStop")
                                }
                                .into_owned(),
                            )
                            .on_click(cx.listener(move |this, _, _, cx| this.send_now(n, cx))),
                        )
                    })
                    .child(
                        Button::icon_only(
                            SharedString::from(format!("queue-edit-{n}")),
                            IconName::Pencil,
                            t!("queue.edit").into_owned(),
                        )
                        .size(Size::Xs)
                        .on_click(cx.listener(move |this, _, window, cx| {
                            if n < this.queue.len() {
                                this.queue.remove(n);
                                let text = text.clone();
                                this.composer.update(cx, |c, cx| c.set_text(text, window, cx));
                                cx.notify();
                            }
                        })),
                    )
                    .child(
                        Button::icon_only(
                            SharedString::from(format!("queue-remove-{n}")),
                            IconName::Trash,
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
                    .into_any_element()
            })
            .collect();
        let queue = (!rows.is_empty()).then(|| {
            div()
                .flex()
                .flex_col()
                .px(px(space::X3))
                .rounded(px(tokens::RADIUS_CARD))
                .border_1()
                .border_color(p.border)
                .bg(p.bg_surface)
                .when(busy && ahead > 0, |c| {
                    c.child(
                        div()
                            .flex()
                            .items_center()
                            .min_h(px(tokens::CONTROL_H_SM))
                            .text_xs()
                            .text_color(p.text_dim)
                            .child(tn("queue.ahead", ahead as i64)),
                    )
                })
                .children(rows)
        });
        let sent = self.sent.map(|key| {
            div()
                .px(px(space::X3))
                .text_xs()
                .text_color(p.text_dim)
                .child(t!(key).into_owned())
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
            .children(sent)
            .children(queue)
            .children(self.who_continues(window, cx))
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
        let editor = self.editor(window, cx);
        let crew = self.crew_drawer(window, cx);
        let viewer = self.viewer(window, cx);
        let side = self.side_panel(window, cx);
        // The conversation, and the side panel beside it when open (its left edge drags the width).
        div()
            .relative()
            .flex()
            .size_full()
            // No background of its own: the canvas card paints it, rounded (GPUI clips children to a square, so a
            // square fill here would show past the card's corners).
            .on_mouse_move(cx.listener(|this, e: &MouseMoveEvent, window, cx| {
                if e.dragging() {
                    this.resize_to(f32::from(e.position.x), window, cx);
                }
            }))
            .on_mouse_up(MouseButton::Left, cx.listener(|this, _, _, cx| this.end_resize(cx)))
            .on_mouse_up_out(MouseButton::Left, cx.listener(|this, _, _, cx| this.end_resize(cx)))
            .child(
                div()
                    .flex()
                    .flex_col()
                    .flex_1()
                    .min_w_0()
                    .h_full()
                    .child(
                        MessageScroller::new(
                            SharedString::from(format!("chat-{}", self.chat_id)),
                            self.scroller.clone(),
                            cx.processor(|this, ix, window, cx| this.render_row(ix, window, cx)),
                        )
                        .flex_1(),
                    )
                    .child(bottom),
            )
            .children(side)
            .children(editor)
            .children(crew)
            .children(viewer)
    }
}
