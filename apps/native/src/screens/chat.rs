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

mod crew;

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
    answers: HashMap<String, Entity<TextareaState>>,
    /// Set when this is a conversation with the Builder.
    builder: Option<BuilderMode>,
    /// The crew drawer (who is in the chat and what each does), and the agents whose card is open in it.
    crew_open: bool,
    crew_expanded: HashSet<String>,
    _subscriptions: Vec<Subscription>,
}

impl ChatScreen {
    /// A conversation with the Builder: its intro, its proposal as a card, and what you write while a proposal is out
    /// asks for a change (it declines the proposal with your words).
    pub fn builder(mut self) -> Self {
        self.builder = Some(BuilderMode::default());
        self
    }

    /// The Builder's open proposal (an agent or a team to create).
    fn proposal(&self) -> Option<&crate::net::types::Approval> {
        self.builder.as_ref()?;
        self.log.approvals.iter().rev().find(|a| a.tool == "zorel_create_agent")
    }

    fn drafts(&self) -> Vec<crate::net::types::ProposedAgent> {
        match self.proposal().and_then(|a| a.proposal.clone()) {
            Some(crate::net::types::ProposalOf::Create { agents }) => agents,
            _ => Vec::new(),
        }
    }

    /// Agents this conversation made (the server's clock on both sides).
    fn made(&self, cx: &App) -> Vec<(crate::net::types::Agent, usize)> {
        let store = self.store.read(cx);
        let since = store.chat(&self.chat_id).map_or(f64::MAX, |c| c.created_at);
        store
            .agents
            .iter()
            .filter(|a| a.builtin.is_none() && a.archived_at.is_none() && a.created_at >= since)
            .map(|a| (a.clone(), store.tone(Some(&a.id))))
            .collect()
    }

    /// Create (approved, with what was edited) or Discard (denied).
    fn decide_proposal(&mut self, approve: bool, cx: &mut Context<Self>) {
        let Some(approval) = self.proposal().map(|a| a.id.clone()) else {
            return;
        };
        let count = self.drafts().len();
        let Some(mode) = &mut self.builder else { return };
        mode.busy = true;
        mode.editing = None;
        let overrides: Vec<serde_json::Value> = (0..count)
            .map(|i| {
                let e = mode.edits.get(i).cloned().unwrap_or_default();
                let mut o = json!({});
                if let Some(m) = e.model {
                    o["model"] = json!(m.model);
                    o["accountId"] = json!(m.account_id);
                    o["effort"] = json!(m.effort);
                }
                if let Some(a) = e.access {
                    o["access"] = serde_json::to_value(a).unwrap_or_default();
                }
                o
            })
            .collect();
        let mut payload = json!({ "approvalId": approval, "outcome": if approve { "approved" } else { "denied" } });
        if approve {
            payload["overrides"] = json!(overrides);
        }
        let (rpc, store) = (self.rpc.clone(), self.store.downgrade());
        cx.spawn(async move |this, cx| {
            let done =
                runtime::spawn(async move { rpc.call::<serde_json::Value>("decide", Some(payload)).await }).await;
            if !matches!(done, Ok(Ok(_))) {
                let _ = this.update(cx, |this, cx| {
                    if let Some(m) = &mut this.builder {
                        m.busy = false;
                    }
                    cx.notify();
                });
            }
            let _ = store.update(cx, |s, cx| s.load(cx)); // the new agents
        })
        .detach();
        self.relayout(cx);
        cx.notify();
    }

    /// The open proposal's setup drawer (one proposed agent), over the conversation.
    fn editor(&mut self, window: &mut Window, cx: &mut Context<Self>) -> Option<AnyElement> {
        let i = self.builder.as_ref()?.editing?;
        let drafts = self.drafts();
        let draft = drafts.get(i)?.clone();
        let store = self.store.clone();
        let view = cx.entity().downgrade();
        let mode = self.builder.as_mut()?;
        let picker = mode
            .pickers
            .entry(i)
            .or_insert_with(|| {
                let view = view.clone();
                let on_change: crate::screens::model_picker::OnChange = Rc::new(move |choice, _, cx| {
                    let _ = view.update(cx, |this, cx| {
                        if let Some(m) = &mut this.builder
                            && let Some(e) = m.edits.get_mut(i)
                        {
                            e.model = Some(choice);
                        }
                        cx.notify();
                    });
                });
                cx.new(|cx| ModelPicker::new(store.clone(), false, on_change, window, cx))
            })
            .clone();
        let edit = mode.edits.get(i).cloned().unwrap_or_default();
        let value = edit.model.clone().unwrap_or(ModelChoice {
            model: draft.model.clone(),
            account_id: None,
            effort: None,
        });
        picker.update(cx, |p, cx| p.set_value(value, cx));
        let tone = self.store.read(cx).agents.len() + i;
        let (access, close) = (view.clone(), view);
        Some(crate::screens::proposal::editor(
            crate::screens::proposal::Editor {
                index: i,
                draft: &draft,
                edit,
                tone,
                picker: picker.into_any_element(),
                on_access: Rc::new(move |i, a, _, cx| {
                    let _ = access.update(cx, |this, cx| {
                        if let Some(m) = &mut this.builder
                            && let Some(e) = m.edits.get_mut(i)
                        {
                            e.access = Some(a);
                        }
                        cx.notify();
                    });
                }),
                on_close: Rc::new(move |_, cx| {
                    let _ = close.update(cx, |this, cx| {
                        if let Some(m) = &mut this.builder {
                            m.editing = None;
                        }
                        cx.notify();
                    });
                }),
            },
            window,
            cx,
        ))
    }

    fn proposal_row(&mut self, window: &mut Window, cx: &mut Context<Self>) -> AnyElement {
        let drafts = self.drafts();
        let approval = self.proposal().map(|a| a.id.clone());
        let Some(mode) = &mut self.builder else {
            return div().into_any_element();
        };
        // A new proposal starts from what the Builder proposed.
        if mode.approval != approval {
            *mode = BuilderMode {
                approval,
                ..BuilderMode::default()
            };
        }
        mode.edits.resize(drafts.len(), Default::default());
        let edits = mode.edits.clone();
        let busy = mode.busy;
        let first_tone = self.store.read(cx).agents.len();
        let models = self.store.read(cx).models.clone();
        let (create, discard, edit) = (
            cx.entity().downgrade(),
            cx.entity().downgrade(),
            cx.entity().downgrade(),
        );
        crate::screens::proposal::card(
            crate::screens::proposal::Card {
                drafts: &drafts,
                edits: &edits,
                first_tone,
                busy,
                models: &models,
                on_create: Rc::new(move |_, cx| {
                    let _ = create.update(cx, |this, cx| this.decide_proposal(true, cx));
                }),
                on_discard: Rc::new(move |_, cx| {
                    let _ = discard.update(cx, |this, cx| this.decide_proposal(false, cx));
                }),
                on_edit: Rc::new(move |i, _, cx| {
                    let _ = edit.update(cx, |this, cx| {
                        if let Some(m) = &mut this.builder {
                            m.editing = Some(i);
                        }
                        cx.notify();
                    });
                }),
            },
            window,
        )
    }
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
        let id = chat_id.clone();
        let on_change: crate::screens::model_picker::OnChange = Rc::new(move |choice, _, cx| {
            let _ = view.update(cx, |this, cx| this.set_model(choice, cx));
            let _ = &id;
        });
        let model = cx.new(|cx| ModelPicker::new(store.clone(), true, on_change, window, cx));
        // Beside Send: the model, and Stop while a reply runs (the web's composer).
        let (tools, chat) = (model.clone(), cx.entity().downgrade());
        composer.update(cx, |c, _| {
            c.set_tools(Rc::new(move |_, cx| {
                let busy = chat
                    .upgrade()
                    .is_some_and(|v| v.read(cx).busy() && v.read(cx).proposal().is_none());
                let chat = chat.clone();
                div()
                    .flex()
                    .items_center()
                    .gap(px(space::X1))
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
            answers: HashMap::new(),
            builder: None,
            crew_open: false,
            crew_expanded: HashSet::new(),
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
        let messages = (0..self.log.messages.len()).map(Row::Message);
        let live = self.log.turns.iter().map(|t| Row::Live(t.id.clone()));
        let mut rows: Vec<Row> = messages.chain(live).collect();
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

    fn submit(&mut self, draft: Draft, window: &mut Window, cx: &mut Context<Self>) {
        // With the Builder's proposal out, what you write asks for a change: the proposal is declined with your words
        // (its turn waits on that decision; a plain message would queue behind it, unread).
        if let Some(id) = self.proposal().map(|a| a.id.clone()) {
            self.store
                .update(cx, |s, cx| s.decide(id, "denied", Some(draft.text), cx));
            return;
        }
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
        let id = self.chat_id.clone();
        self.store.update(cx, |s, cx| {
            if let Some(c) = s.chats.chats.iter_mut().find(|c| c.id == id) {
                c.model = choice.model.clone();
                c.account_id = choice.account_id.clone();
            }
            cx.notify();
        });
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
                    )
                    // Not while a reply runs: the engine can't go back under a live turn.
                    .when(!self.busy(), |r| {
                        let message = m.clone();
                        r.child(
                            Button::icon_only(
                                SharedString::from(format!("rewind-{}", m.id)),
                                IconName::Pencil,
                                t!("chat.editFromHere").into_owned(),
                            )
                            .size(Size::Xs)
                            .on_click(cx.listener(move |this, _, window, cx| this.ask_rewind(&message, window, cx))),
                        )
                    }),
            )
            .into_any_element()
    }

    /// "Edit from here": this message and everything after leave the conversation and the message comes back to the
    /// box; when later turns changed files, a switch also takes those changes back (on by default, as the web).
    fn ask_rewind(&mut self, message: &Message, window: &mut Window, cx: &mut Context<Self>) {
        use gpui_kit::component::WindowExt as _;
        let changes = self
            .log
            .messages
            .iter()
            .any(|m| m.at >= message.at && !m.changes.is_empty() && m.reverted_at.is_none());
        let files = Rc::new(std::cell::Cell::new(true));
        let error: Rc<std::cell::RefCell<Option<String>>> = Rc::default();
        let (view, id, at) = (cx.entity().downgrade(), message.id.clone(), message.at);
        window.open_dialog(cx, move |dialog, window, cx| {
            let p = theme::palette(window);
            let mut body: Vec<AnyElement> = Vec::new();
            if changes {
                let files = files.clone();
                body.push(crate::ui::switch::switch(
                    "rewind-files",
                    t!("chat.rewindFiles").into_owned(),
                    files.get(),
                    Rc::new(move |on, window, _| {
                        files.set(on);
                        window.refresh();
                    }),
                    window,
                    cx,
                ));
            }
            if let Some(e) = error.borrow().clone() {
                body.push(div().text_sm().text_color(p.danger).child(e).into_any_element());
            }
            let (view, id, files, error) = (view.clone(), id.clone(), files.clone(), error.clone());
            crate::ui::dialog::sheet(
                dialog,
                window,
                crate::ui::dialog::Width::Sm,
                crate::ui::dialog::Sheet {
                    title: t!("chat.rewindTitle").into_owned(),
                    description: Some(t!("chat.rewindBody").into_owned()),
                    body: (!body.is_empty()).then(|| {
                        div()
                            .flex()
                            .flex_col()
                            .gap(px(space::X3))
                            .children(body)
                            .into_any_element()
                    }),
                    actions: vec![
                        Button::new("cancel", t!("common.cancel").into_owned())
                            .on_click(|_, window, cx| window.close_dialog(cx))
                            .into_any_element(),
                        Button::new("rewind", t!("chat.rewindAction").into_owned())
                            .variant(Variant::Primary)
                            .on_click(move |_, window, cx| {
                                let files = changes && files.get();
                                let (view, id, error) = (view.clone(), id.clone(), error.clone());
                                let Some(this) = view.upgrade() else { return };
                                let (http, chat_id) =
                                    (this.read(cx).store.read(cx).http.clone(), this.read(cx).chat_id.clone());
                                window
                                    .spawn(cx, async move |cx| {
                                        let path = format!("/api/chats/{chat_id}/rewind");
                                        let body = json!({ "messageId": id, "files": files });
                                        let done = runtime::spawn(async move {
                                            http.post::<_, serde_json::Value>(&path, &body).await
                                        })
                                        .await;
                                        let _ = cx.update(|window, cx| match done {
                                            Ok(Ok(v)) => {
                                                let text = v["text"].as_str().unwrap_or_default().to_string();
                                                window.close_dialog(cx);
                                                let _ = view.update(cx, |this, cx| this.rewound(at, text, window, cx));
                                            }
                                            Ok(Err(e)) => {
                                                *error.borrow_mut() = Some(match conflict_files(&e) {
                                                    Some(f) => t!("workspace.undoConflict", files = f).into_owned(),
                                                    None => t!("chat.rewindFailed").into_owned(),
                                                });
                                                window.refresh();
                                            }
                                            Err(_) => {
                                                *error.borrow_mut() = Some(t!("chat.rewindFailed").into_owned());
                                                window.refresh();
                                            }
                                        });
                                    })
                                    .detach();
                            })
                            .into_any_element(),
                    ],
                },
            )
        });
    }

    /// The engine went back: the messages from `at` on leave the timeline and the text returns to the box.
    fn rewound(&mut self, at: f64, text: String, window: &mut Window, cx: &mut Context<Self>) {
        self.log.messages.retain(|m| m.at < at);
        self.log.revision += 1;
        self.composer.update(cx, |c, cx| c.set_text(text, window, cx));
        self.relayout(cx);
        cx.notify();
    }

    /// The files a turn changed: how many and how much (+added −removed), and Undo (confirmed) or "Undone".
    fn turn_changes(&mut self, m: &Message, window: &mut Window, cx: &mut Context<Self>) -> Option<AnyElement> {
        let turn = m.turn_id.clone().filter(|_| !m.changes.is_empty())?;
        let p = theme::palette(window);
        let added: f64 = m.changes.iter().map(|c| c.added).sum();
        let removed: f64 = m.changes.iter().map(|c| c.removed).sum();
        let error = self.undo_errors.get(&turn).cloned();
        let row = div()
            .flex()
            .flex_wrap()
            .items_center()
            .gap(px(space::X2))
            .self_start()
            .px(px(space::X3))
            .py(px(space::X1))
            .rounded(px(tokens::RADIUS_CARD))
            .border_1()
            .border_color(p.border)
            .text_sm()
            .child(icon(IconName::File, icon::XS).text_color(p.text_muted))
            .child(
                div()
                    .text_color(p.text_secondary)
                    .child(tn("workspace.filesChanged", m.changes.len() as i64)),
            )
            .child(div().text_color(p.success).child(format!("+{added:.0}")))
            .child(div().text_color(p.danger).child(format!("−{removed:.0}")))
            .map(|r| {
                if m.reverted_at.is_some() {
                    r.child(
                        div()
                            .text_color(p.text_muted)
                            .child(format!("· {}", t!("workspace.undone"))),
                    )
                } else {
                    let turn = turn.clone();
                    r.child(
                        Button::new(
                            SharedString::from(format!("undo-{turn}")),
                            t!("workspace.undo").into_owned(),
                        )
                        .variant(Variant::Ghost)
                        .size(Size::Xs)
                        .on_click(cx.listener(move |this, _, window, cx| this.ask_undo(turn.clone(), window, cx))),
                    )
                }
            });
        Some(
            div()
                .flex()
                .flex_col()
                .gap(px(space::X1_5))
                .child(row)
                .when_some(error, |c, e| c.child(div().text_sm().text_color(p.danger).child(e)))
                .into_any_element(),
        )
    }

    /// Undo a turn's file changes, after a confirmation: marked undone at once, put back if the engine refuses.
    fn ask_undo(&mut self, turn: String, window: &mut Window, cx: &mut Context<Self>) {
        use gpui_kit::component::WindowExt as _;
        let view = cx.entity().downgrade();
        window.open_dialog(cx, move |dialog, window, _| {
            let (view, turn) = (view.clone(), turn.clone());
            crate::ui::dialog::sheet(
                dialog,
                window,
                crate::ui::dialog::Width::Sm,
                crate::ui::dialog::Sheet {
                    title: t!("workspace.undoTitle").into_owned(),
                    description: Some(t!("workspace.undoBody").into_owned()),
                    body: None,
                    actions: vec![
                        Button::new("cancel", t!("common.cancel").into_owned())
                            .on_click(|_, window, cx| window.close_dialog(cx))
                            .into_any_element(),
                        Button::new("undo", t!("workspace.undo").into_owned())
                            .variant(Variant::Destructive)
                            .on_click(move |_, window, cx| {
                                window.close_dialog(cx);
                                let _ = view.update(cx, |this, cx| this.undo(turn.clone(), cx));
                            })
                            .into_any_element(),
                    ],
                },
            )
        });
    }

    fn undo(&mut self, turn: String, cx: &mut Context<Self>) {
        mark_reverted(&mut self.log, &turn, Some(format::now_ms()));
        self.undo_errors.remove(&turn);
        cx.notify();
        let http = self.store.read(cx).http.clone();
        let path = format!("/api/turns/{turn}/undo");
        cx.spawn(async move |this, cx| {
            let done = runtime::spawn(async move { http.post::<_, serde_json::Value>(&path, &json!({})).await }).await;
            let failed = match done {
                Ok(Ok(_)) => return,
                Ok(Err(e)) => conflict_files(&e).map(|f| t!("workspace.undoConflict", files = f).into_owned()),
                Err(_) => None,
            };
            let _ = this.update(cx, |this, cx| {
                mark_reverted(&mut this.log, &turn, None);
                this.undo_errors.insert(
                    turn.clone(),
                    failed.unwrap_or_else(|| t!("workspace.undoFailed").into_owned()),
                );
                cx.notify();
            });
        })
        .detach();
    }

    /// The agents a reply may mention, in their colours; a click starts a chat with one.
    fn mentions(&self, window: &Window, cx: &mut Context<Self>) -> markdown::Mentions {
        let p = theme::palette(window);
        let store = self.store.read(cx);
        let people = store
            .agents
            .iter()
            .filter(|a| a.archived_at.is_none())
            .map(|a| {
                let tone = store.tone(Some(&a.id));
                markdown::Person {
                    handle: crate::state::crew::handle_of(&a.name).to_lowercase(),
                    id: a.id.clone(),
                    name: a.name.clone(),
                    tone,
                    hue: face::hue(p, tone),
                }
            })
            .collect();
        let view = cx.entity().downgrade();
        markdown::Mentions {
            people,
            open: Rc::new(move |id, _, cx| {
                let _ = view.update(cx, |_, cx| cx.emit(ChatEvent::ChatWith(id)));
            }),
        }
    }

    /// A finished reply: who (unless solo or continuing), its text and steps as they happened, how it ended.
    fn reply_row(&mut self, i: usize, m: &Message, window: &mut Window, cx: &mut Context<Self>) -> AnyElement {
        let p = theme::palette(window);
        let mentions = self.mentions(window, cx);
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
                    column.push(markdown::render_with(&key, blocks, Some(&mentions), window).into_any_element());
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

        column.extend(self.turn_changes(m, window, cx));

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
        // The details behind ⓘ: model, tokens, how long, which account and what it cost (a subscription shows the
        // API equivalent, not a charge).
        let account = m
            .account_id
            .as_deref()
            .and_then(|id| store.accounts.iter().find(|a| a.id == id));
        let subscription =
            account.is_some_and(|a| matches!(a.kind, crate::net::types::ProviderAccountKind::Subscription));
        let details: Vec<String> = [
            model.clone(),
            (m.input_tokens > 0. || m.output_tokens > 0.).then(|| {
                t!(
                    "chat.tokens",
                    input = format::compact(m.input_tokens),
                    output = format::compact(m.output_tokens)
                )
                .into_owned()
            }),
            m.duration_ms
                .filter(|ms| *ms >= 1000.)
                .map(|ms| format::duration(ms, format::lang())),
            account.map(|a| a.label.clone()),
            m.cost.map(|c| {
                if subscription {
                    format!("{} {}", t!("usage.apiEquivalent"), format::cost(c))
                } else {
                    format::cost(c)
                }
            }),
        ]
        .into_iter()
        .flatten()
        .collect();
        let group = SharedString::from(format!("reply-{}", m.id));
        let copied = self.copied.as_deref() == Some(&m.id);
        let (id, body) = (m.id.clone(), m.text.clone());
        let actions = div()
            .flex()
            .items_center()
            .gap(px(space::X0_5))
            .ml(px(-space::X1_5))
            .h(px(tokens::CONTROL_H_XS))
            .opacity(0.)
            .group_hover(group.clone(), |s| s.opacity(1.))
            .when(!m.text.is_empty(), |r| {
                r.child(
                    Button::icon_only(
                        SharedString::from(format!("copy-{}", m.id)),
                        if copied { IconName::Check } else { IconName::Copy },
                        if copied { t!("common.copied") } else { t!("common.copy") }.into_owned(),
                    )
                    .size(Size::Xs)
                    .on_click(cx.listener(move |this, _, _, cx| this.copy(id.clone(), body.clone(), cx))),
                )
            })
            .when(!details.is_empty(), |r| {
                r.child(
                    Button::icon_only(
                        SharedString::from(format!("details-{}", m.id)),
                        IconName::Info,
                        t!("chat.details").into_owned(),
                    )
                    .size(Size::Xs)
                    .tooltip(details.join("\n")),
                )
            })
            .child(
                div()
                    .px(px(space::X1_5))
                    .text_xs()
                    .text_color(p.text_dim)
                    .child(format::time(m.at, format::now_ms(), format::lang())),
            )
            .into_any_element();
        column.push(actions);
        div()
            .group(group)
            .child(reply_frame(
                &m.id,
                (!bare && !continued).then_some((tone, name, hue, model)),
                bare,
                FaceState::Idle,
                column,
                p,
            ))
            .into_any_element()
    }

    /// Every reply shows who answers (face and name, as the prototype); it continues the previous one (no face again)
    /// when the same agent answers within 5 minutes.
    fn voice(&self, i: usize, m: &Message, _: &App) -> (bool, bool) {
        let bare = false;
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
        let mut parts: Vec<AnyElement> = vec![div().truncate().child(steps::sentence(&summary)).into_any_element()];
        if summary.failed > 0 {
            parts.push(
                div()
                    .flex_none()
                    .text_color(p.danger)
                    .child(format!("· {}", tn("activity.errors", summary.failed as i64)))
                    .into_any_element(),
            );
        }
        if summary.refused > 0 {
            parts.push(
                div()
                    .flex_none()
                    .text_color(p.warning)
                    .child(format!("· {}", tn("activity.refused", summary.refused as i64)))
                    .into_any_element(),
            );
        }
        if let Some(ms) = took.filter(|ms| *ms >= 1000.) {
            parts.push(
                div()
                    .flex_none()
                    .text_color(p.text_dim)
                    .child(format!("· {}", format::duration(ms, l)))
                    .into_any_element(),
            );
        }
        let view = cx.entity().downgrade();
        let head_key = key.to_string();
        let toggle: step_tree::OnToggle = Rc::new(move |_, cx| {
            let _ = view.update(cx, |this, cx| this.toggle(head_key.clone(), cx));
        });
        let head = step_tree::head(
            step_tree::Head {
                key: key.to_string(),
                open,
                rows: !shown.is_empty(),
                leading: None,
                parts,
                on_toggle: toggle,
            },
            window,
            cx,
        );
        // The last step that is work (a thought after it doesn't carry the trunk on).
        let last_work = shown.iter().rposition(|s| s.tool != "thought");
        let list = open.then(|| {
            let rows: Vec<AnyElement> = shown
                .iter()
                .enumerate()
                .map(|(n, s)| {
                    if s.tool == "thought" {
                        step_tree::note(
                            t!("activity.thought", time = format::duration(s.ms.unwrap_or(0.), l)).into_owned(),
                            last_work.is_none_or(|w| n > w),
                            window,
                        )
                    } else {
                        self.stored_step(&format!("{key}-{n}"), s, Some(n) == last_work, window, cx)
                    }
                })
                .collect();
            motion::enter(
                step_tree::list(rows),
                SharedString::from(format!("fold-{key}")),
                motion::MENU_IN_MS,
                4.,
            )
        });
        div().flex().flex_col().child(head).children(list).into_any_element()
    }

    /// One finished step: its title in plain words (the command, path or URL on hover), how long it took or that it
    /// failed; it opens to the whole command and the start of its output.
    fn stored_step(
        &mut self,
        key: &str,
        s: &Step,
        last: bool,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> AnyElement {
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
        let hint = s
            .detail
            .clone()
            .filter(|d| !d.is_empty())
            .or_else(|| (s.tool == "run").then(|| s.args.clone()))
            .filter(|h| *h != title);
        let (tone, fact) = match s.status {
            StepStatus::Error => (
                step_tree::Tone::Danger,
                Some((t!("activity.failedStep").into_owned(), p.danger)),
            ),
            StepStatus::Refused => (
                step_tree::Tone::Warning,
                Some((t!("activity.refusedStep").into_owned(), p.warning)),
            ),
            _ => (
                step_tree::Tone::Default,
                s.ms.filter(|ms| *ms >= 1000.)
                    .map(|ms| (format::duration(ms, format::lang()), p.text_dim)),
            ),
        };
        let can_open = !command.is_empty() || !s.result.is_empty();
        let open = self.open.contains(key);
        let toggle = can_open.then(|| {
            let (view, k) = (cx.entity().downgrade(), key.to_string());
            Rc::new(move |_: &mut Window, cx: &mut App| {
                let _ = view.update(cx, |this, cx| this.toggle(k.clone(), cx));
            }) as step_tree::OnToggle
        });
        let result: String = s.result.lines().take(3).collect::<Vec<_>>().join("\n");
        let mut body = Vec::new();
        if !command.is_empty() {
            body.push(code_box(command, p.text_secondary, p).into_any_element());
        }
        if !result.is_empty() {
            body.push(code_box(result, p.text_muted, p).into_any_element());
        }
        step_tree::Row {
            key: key.to_string(),
            icon: icon(glyph_of(&s.tool), icon::XS).into_any_element(),
            tone,
            title,
            facts: fact
                .map(|(f, c)| div().text_color(c).child(f).into_any_element())
                .into_iter()
                .collect(),
            hint,
            last,
            open,
            on_toggle: toggle,
            body,
        }
        .render(window, cx)
    }

    /// A turn in progress, laid out as it happens (the web's LiveMessage): what it has written so far, cut where steps
    /// began, each run of steps a group (its summary, open while it works) on the tree; at the end what it does now
    /// (a light sweeps across it; plainly while it waits), the time only after 5 s, and Stop beside it.
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
        // With the Builder's proposal out, its waiting step is the card itself: not repeated as a step or a status.
        let proposal_out = self.proposal().is_some();
        let live_steps: Vec<WorkStep> = self
            .log
            .steps
            .iter()
            .filter(|s| s.turn_id == turn_id)
            .filter(|s| !(proposal_out && matches!(s.status, WorkStepStatus::Waiting)))
            .cloned()
            .collect();
        let thought = self.log.thought.get(turn_id).cloned().unwrap_or_default();
        let mentions = self.mentions(window, cx);
        let mut column: Vec<AnyElement> = Vec::new();
        // Its thinking, once over: how long (a finished reply keeps it in its steps).
        if !thought.now && thought.took >= 1000. {
            column.push(
                step_line(
                    &format!("{turn_id}-thought"),
                    IconName::Brain,
                    p.text_muted,
                    t!(
                        "activity.thought",
                        time = format::duration(thought.took, format::lang())
                    )
                    .into_owned(),
                    None,
                    p,
                )
                .into_any_element(),
            );
        }
        let at = self.log.step_at.clone();
        let pieces = steps::interleave(&text, &live_steps, |s| at.get(&s.id).copied());
        for (n, piece) in pieces.into_iter().enumerate() {
            match piece {
                Piece::Text(text) => {
                    let blocks = markdown::parse(&text);
                    column.push(
                        markdown::render_with(&format!("{turn_id}-t{n}"), &blocks, Some(&mentions), window)
                            .into_any_element(),
                    );
                }
                Piece::Steps(group) => column.push(self.live_group(&format!("{turn_id}-g{n}"), &group, window, cx)),
            }
        }
        // While it thinks: the last of its words, quiet, two lines at most (engines that show them).
        if thought.now && !proposal_out {
            let words = last_words(&thought.text, 240);
            if !words.is_empty() {
                column.push(
                    div()
                        .text_sm()
                        .text_color(p.text_dim)
                        .line_clamp(2)
                        .child(words)
                        .into_any_element(),
                );
            }
        }
        let store = self.store.read(cx);
        let name = store.agent_name(agent.as_deref());
        let tone = store.tone(agent.as_deref());
        // What it does now. Waiting for you (an approval, a question): say so, not the step's title again.
        let current = live_steps
            .iter()
            .rev()
            .find(|s| matches!(s.status, WorkStepStatus::Running | WorkStepStatus::Waiting));
        let asks = self.log.approvals.iter().any(|a| a.turn_id.as_deref() == Some(turn_id));
        let waiting = asks || current.is_some_and(|s| matches!(s.status, WorkStepStatus::Waiting));
        let idle = text.is_empty() && live_steps.is_empty();
        let label = match current {
            _ if waiting => {
                let question = current
                    .and_then(|s| s.tool.as_deref())
                    .is_some_and(|t| t.ends_with("zorel_ask_user"));
                t!(
                    if question { "status.asking" } else { "approval.waitsFor" },
                    agent = name
                )
                .into_owned()
            }
            Some(step) => step.title.clone(),
            None if thought.now => t!("activity.thinking").into_owned(),
            None if idle => {
                let model = turn.as_ref().map(|t| t.model.clone()).unwrap_or_default();
                let (provider, _) = crate::labels::split_model(&model);
                t!(
                    "activity.waitingFor",
                    provider = crate::labels::provider_label(provider)
                )
                .into_owned()
            }
            None => t!("activity.working").into_owned(),
        };
        let started = turn.as_ref().and_then(|t| t.started_at);
        let elapsed = started
            .map(|at| format::now_ms() - at)
            .filter(|ms| *ms >= 5000. && !waiting)
            .map(|ms| format::duration(ms, format::lang()));
        if !proposal_out {
            let mark: AnyElement = if waiting {
                icon(IconName::Clock, icon::SM).text_color(p.warning).into_any_element()
            } else {
                Loader::new(SharedString::from(format!("live-mark-{turn_id}")))
                    .size(icon::SM)
                    .color(p.text_muted)
                    .into_any_element()
            };
            // Plain while it waits (on you, or on the provider before anything came back); a light sweeps otherwise.
            let words: AnyElement = if waiting || idle {
                div()
                    .truncate()
                    .text_color(if waiting { p.warning } else { p.text_muted })
                    .child(label)
                    .into_any_element()
            } else {
                shimmer(
                    SharedString::from(format!("live-shimmer-{turn_id}")),
                    label,
                    p.text_muted,
                    p.text,
                )
                .into_any_element()
            };
            column.push(
                div()
                    .flex()
                    .items_center()
                    .gap(px(space::X2))
                    .h(px(tokens::CONTROL_H_SM))
                    .text_sm()
                    .child(div().flex_none().w(px(icon::MD)).flex().justify_center().child(mark))
                    .child(div().min_w_0().child(words))
                    .when_some(elapsed, |r, e| {
                        r.child(div().flex_none().text_color(p.text_dim).child(format!("· {e}")))
                    })
                    .child(
                        Button::stop(
                            SharedString::from(format!("live-stop-{turn_id}")),
                            t!("composer.stop").into_owned(),
                        )
                        .size(Size::Xs)
                        .on_click(cx.listener(|this, _, _, cx| this.stop(cx))),
                    )
                    .into_any_element(),
            );
        }
        reply_frame(
            turn_id,
            Some((tone, name, face::hue(p, tone), None)),
            false,
            // A question or a proposal waits on you: the face says so, not "working".
            if waiting || proposal_out {
                FaceState::Waiting
            } else {
                FaceState::Working
            },
            column,
            p,
        )
    }

    /// One run of a live turn's steps: its summary (a turning mark while one runs, the clock while one waits for
    /// you) and, open by default, its steps on the tree as they come.
    fn live_group(&mut self, key: &str, group: &[WorkStep], window: &mut Window, cx: &mut Context<Self>) -> AnyElement {
        let p = theme::palette(window);
        let kinds: Vec<String> = group.iter().map(kind_key).collect();
        let summed: Vec<Summed> = group
            .iter()
            .zip(&kinds)
            .map(|(s, kind)| Summed {
                kind,
                status: match s.status {
                    WorkStepStatus::Error => "error",
                    WorkStepStatus::Refused => "refused",
                    _ => "ok",
                },
                detail: if s.detail.is_empty() { &s.title } else { &s.detail },
                files: s.files.iter().map(String::as_str).collect(),
            })
            .collect();
        let summary = steps::summarize(&summed);
        // Open unless closed here (the key marks a closed live group).
        let closed_key = format!("{key}-closed");
        let open = !self.open.contains(&closed_key);
        let working = group
            .iter()
            .find(|s| matches!(s.status, WorkStepStatus::Running | WorkStepStatus::Waiting));
        let lead: Option<AnyElement> = working.map(|s| {
            if matches!(s.status, WorkStepStatus::Waiting) {
                icon(IconName::Clock, icon::XS).text_color(p.warning).into_any_element()
            } else {
                Loader::new(SharedString::from(format!("live-group-{key}")))
                    .size(icon::XS)
                    .into_any_element()
            }
        });
        let mut parts: Vec<AnyElement> = vec![div().truncate().child(steps::sentence(&summary)).into_any_element()];
        if summary.failed > 0 {
            parts.push(
                div()
                    .flex_none()
                    .text_color(p.danger)
                    .child(format!("· {}", tn("activity.errors", summary.failed as i64)))
                    .into_any_element(),
            );
        }
        if summary.refused > 0 {
            parts.push(
                div()
                    .flex_none()
                    .text_color(p.warning)
                    .child(format!("· {}", tn("activity.refused", summary.refused as i64)))
                    .into_any_element(),
            );
        }
        let view = cx.entity().downgrade();
        let toggle: step_tree::OnToggle = Rc::new(move |_, cx| {
            let _ = view.update(cx, |this, cx| this.toggle(closed_key.clone(), cx));
        });
        let head = step_tree::head(
            step_tree::Head {
                key: key.to_string(),
                open,
                rows: !group.is_empty(),
                leading: lead,
                parts,
                on_toggle: toggle,
            },
            window,
            cx,
        );
        let list = open.then(|| {
            let n = group.len();
            step_tree::list(
                group
                    .iter()
                    .enumerate()
                    .map(|(i, s)| {
                        let (tone, fact) = match s.status {
                            WorkStepStatus::Waiting => (
                                step_tree::Tone::Warning,
                                Some((t!("activity.waiting").into_owned(), p.warning)),
                            ),
                            WorkStepStatus::Error => (
                                step_tree::Tone::Danger,
                                Some((t!("activity.failedStep").into_owned(), p.danger)),
                            ),
                            WorkStepStatus::Refused => (
                                step_tree::Tone::Warning,
                                Some((t!("activity.refusedStep").into_owned(), p.warning)),
                            ),
                            _ => (
                                step_tree::Tone::Default,
                                s.duration_ms
                                    .filter(|ms| *ms >= 1000.)
                                    .map(|ms| (format::duration(ms, format::lang()), p.text_dim)),
                            ),
                        };
                        let mark: AnyElement = match s.status {
                            WorkStepStatus::Running => Loader::new(SharedString::from(format!("live-step-{}", s.id)))
                                .size(icon::XS)
                                .into_any_element(),
                            WorkStepStatus::Waiting => icon(IconName::Clock, icon::XS).into_any_element(),
                            _ => icon(glyph_of(&kind_key(s)), icon::XS).into_any_element(),
                        };
                        motion::enter(
                            div().child(
                                step_tree::Row {
                                    key: format!("live-{}", s.id),
                                    icon: mark,
                                    tone,
                                    title: s.title.clone(),
                                    facts: fact
                                        .map(|(f, c)| div().text_color(c).child(f).into_any_element())
                                        .into_iter()
                                        .collect(),
                                    hint: (!s.detail.is_empty() && s.detail != s.title).then(|| s.detail.clone()),
                                    last: i + 1 == n,
                                    open: false,
                                    on_toggle: None,
                                    body: Vec::new(),
                                }
                                .render(window, cx),
                            ),
                            SharedString::from(format!("live-step-in-{}", s.id)),
                            motion::ENTER_MS,
                            4.,
                        )
                        .into_any_element()
                    })
                    .collect(),
            )
        });
        div().flex().flex_col().child(head).children(list).into_any_element()
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
        let editor = self.editor(window, cx);
        let crew = self.crew_drawer(window, cx);
        div()
            .relative()
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
            .children(editor)
            .children(crew)
    }
}

/// A reply's frame: the face (and name, in the agent's hue; the model on hover) on the left, then its column.
/// The tail of a growing text, at most `max` chars, starting at a word, on one line.
fn last_words(text: &str, max: usize) -> String {
    let flat = text.split_whitespace().collect::<Vec<_>>().join(" ");
    let n = flat.chars().count();
    if n <= max {
        return flat;
    }
    let tail: String = flat.chars().skip(n - max).collect();
    match tail.split_once(' ') {
        Some((_, rest)) => format!("…{rest}"),
        None => tail,
    }
}

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
        .when(!bare, |r| r.child(div().flex_none().w(px(28.)).children(face)))
        .child(
            div()
                .flex()
                .flex_col()
                .flex_1()
                .min_w_0()
                .gap(px(space::X2))
                .when_some(who, |c, (_, name, hue, model)| {
                    c.child(
                        // As tall as the face, its words centred on it.
                        div()
                            .flex()
                            .items_center()
                            .h(px(28.))
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

/// The files an engine conflict names (`{"files": [...]}` in its 409 body), joined for a message.
fn conflict_files(e: &crate::net::http::HttpError) -> Option<String> {
    let crate::net::http::HttpError::Status(_, body) = e else {
        return None;
    };
    let v: serde_json::Value = serde_json::from_str(body).ok()?;
    let files: Vec<&str> = v["files"].as_array()?.iter().filter_map(|f| f.as_str()).collect();
    (!files.is_empty()).then(|| files.join(", "))
}

/// Marks (or unmarks) the messages of a turn as undone.
fn mark_reverted(log: &mut ChatLog, turn: &str, at: Option<f64>) {
    for m in log.messages.iter_mut().filter(|m| m.turn_id.as_deref() == Some(turn)) {
        m.reverted_at = at;
    }
    log.revision += 1;
}
