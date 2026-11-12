// One chat (spec 019 T030/T032): its history and live reply in the kit's MessageScroller (virtualised, follows the
// tail while you're there, keeps your place when you scroll up and offers a jump back), the approval cards that wait
// for you, and the composer. A streaming delta re-measures only the reply's own row.
use std::collections::HashMap;

use gpui_kit::{
    base::input::{InputEvent, Textarea, TextareaState},
    component::message_scroller::{MessageScroller, MessageScrollerState},
    *,
};
use rust_i18n::t;
use serde_json::json;

use crate::ui::space;
use crate::{
    net::{
        rpc::Rpc,
        types::{MessageRole, SubscribeChatItem},
    },
    state::{chat::ChatLog, store::Store},
    theme::{self, tokens},
    ui::{
        button::{Button, Size, Variant},
        face::{AgentFace, FaceState},
        layout,
        markdown::{self, Block},
    },
};

/// What a list row shows: a message, the reply being written for a turn, or an approval waiting for you.
#[derive(Clone, PartialEq)]
enum Row {
    Message(usize),
    Partial(String),
    Approval(usize),
}

pub struct ChatScreen {
    chat_id: String,
    store: Entity<Store>,
    rpc: Rpc,
    log: ChatLog,
    rows: Vec<Row>,
    /// The kit's message scroller: follows the tail, keeps the reader's place when scrolled up, offers a jump back.
    scroller: Entity<MessageScrollerState>,
    /// Parsed markdown per message id: a finished message is parsed once.
    parsed: HashMap<String, Vec<Block>>,
    composer: Entity<TextareaState>,
    _subscriptions: Vec<Subscription>,
}

impl ChatScreen {
    pub fn new(chat_id: String, store: Entity<Store>, window: &mut Window, cx: &mut Context<Self>) -> Self {
        let rpc = store.read(cx).rpc.clone();
        cx.observe(&store, |_, _, cx| cx.notify()).detach(); // agent names and hues
        let scroller = cx.new(|cx| MessageScrollerState::new(0, cx));
        cx.observe(&scroller, |_, _, cx| cx.notify()).detach();
        let composer = cx.new(|cx| {
            let mut state = TextareaState::new(window, cx).placeholder(t!("composer.placeholder").into_owned());
            state.set_auto_grow(1, 8, cx);
            state
        });
        let send = cx.subscribe_in(&composer, window, |this, _, event: &InputEvent, window, cx| {
            if let InputEvent::PressEnter { shift: false, .. } = event {
                this.send(window, cx);
            }
        });
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
            rows: Vec::new(),
            scroller,
            parsed: HashMap::new(),
            composer,
            _subscriptions: vec![send],
        }
    }

    fn apply(&mut self, event: SubscribeChatItem, cx: &mut Context<Self>) {
        // A text delta only grows its reply's row: re-measure that one, not the list.
        let delta_turn = match &event {
            SubscribeChatItem::Text { turn_id, .. } => Some(turn_id.clone()),
            _ => None,
        };
        self.log.apply(event);
        let rows = self.rows();
        match delta_turn.and_then(|turn| rows.iter().position(|r| matches!(r, Row::Partial(t) if *t == turn))) {
            Some(ix) if rows == self.rows => {
                self.scroller.update(cx, |s, cx| {
                    s.remeasure_items(ix..ix + 1, cx);
                });
            }
            _ => {
                let count = rows.len();
                self.scroller.update(cx, |s, cx| s.reset(count, cx));
                self.rows = rows;
            }
        }
        cx.notify();
    }

    fn rows(&self) -> Vec<Row> {
        let messages = (0..self.log.messages.len()).map(Row::Message);
        let partial = self
            .log
            .turns
            .iter()
            .filter(|t| self.log.partial.contains_key(&t.id))
            .map(|t| Row::Partial(t.id.clone()));
        let approvals = (0..self.log.approvals.len()).map(Row::Approval);
        messages.chain(partial).chain(approvals).collect()
    }

    fn send(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        let text = self.composer.read(cx).value().trim().to_string();
        if text.is_empty() {
            return;
        }
        self.composer.update(cx, |c, cx| c.set_value("", window, cx));
        let (rpc, chat_id) = (self.rpc.clone(), self.chat_id.clone());
        let client_id = format!("native-{}", uuid());
        cx.background_spawn(async move {
            let payload = json!({ "chatId": chat_id, "clientId": client_id, "text": text });
            if let Err(e) = rpc.call::<serde_json::Value>("send", Some(payload)).await {
                eprintln!("send: {e}"); // ponytail: shown in the chat with the error states (T059)
            }
        })
        .detach();
    }

    fn decide(&self, approval_id: String, outcome: &'static str, cx: &mut Context<Self>) {
        let rpc = self.rpc.clone();
        cx.background_spawn(async move {
            let payload = json!({ "approvalId": approval_id, "outcome": outcome });
            if let Err(e) = rpc.call::<serde_json::Value>("decide", Some(payload)).await {
                eprintln!("decide: {e}");
            }
        })
        .detach();
    }

    fn render_row(&mut self, ix: usize, window: &mut Window, cx: &mut Context<Self>) -> AnyElement {
        let p = theme::palette(window);
        let Some(row) = self.rows.get(ix).cloned() else {
            return div().into_any_element();
        };
        let body = match row {
            Row::Message(i) => {
                let m = &self.log.messages[i];
                let blocks = self
                    .parsed
                    .entry(m.id.clone())
                    .or_insert_with(|| markdown::parse(&m.text));
                let text = markdown::render(&m.id, blocks, window);
                match m.role {
                    MessageRole::User => div().flex().justify_end().child(
                        div()
                            .max_w(px(560.))
                            .rounded(px(tokens::RADIUS_CARD))
                            .bg(p.bg_control)
                            .px(px(space::X3))
                            .py(px(space::X2))
                            .child(text),
                    ),
                    _ => self.agent_row(
                        self.store.read(cx).tone(m.agent_id.as_deref()),
                        FaceState::Idle,
                        text,
                        &m.id,
                    ),
                }
            }
            Row::Partial(turn_id) => {
                let agent = self
                    .log
                    .turns
                    .iter()
                    .find(|t| t.id == turn_id)
                    .and_then(|t| t.agent_id.clone());
                let text = self.log.partial.get(&turn_id).map(String::as_str).unwrap_or_default();
                let blocks = markdown::parse(text);
                let body = markdown::render(&turn_id, &blocks, window);
                self.agent_row(
                    self.store.read(cx).tone(agent.as_deref()),
                    FaceState::Working,
                    body,
                    &turn_id,
                )
            }
            Row::Approval(i) => {
                let a = &self.log.approvals[i];
                let id = a.id.clone();
                let (allow, deny) = (id.clone(), id.clone());
                layout::card(p)
                    .flex()
                    .flex_col()
                    .gap(px(space::X2_5))
                    .p(px(space::X4))
                    .child(
                        div()
                            .text_color(p.warning)
                            .text_sm()
                            .child(t!("approval.waiting").into_owned()),
                    )
                    .child(div().child(a.summary.clone()))
                    .child(
                        div()
                            .flex()
                            .gap(px(space::X2))
                            .justify_end()
                            .child(
                                Button::new(
                                    SharedString::from(format!("deny-{id}")),
                                    t!("approval.deny").into_owned(),
                                )
                                .size(Size::Sm)
                                .on_click(cx.listener(move |this, _, _, cx| this.decide(deny.clone(), "denied", cx))),
                            )
                            .child(
                                Button::new(
                                    SharedString::from(format!("allow-{id}")),
                                    t!("approval.allow").into_owned(),
                                )
                                .variant(Variant::Primary)
                                .size(Size::Sm)
                                .on_click(
                                    cx.listener(move |this, _, _, cx| this.decide(allow.clone(), "approved", cx)),
                                ),
                            ),
                    )
            }
        };
        div()
            .px(px(space::X6))
            .py(px(space::X2))
            .max_w(px(760.))
            .w_full()
            .mx_auto()
            .child(body)
            .into_any_element()
    }

    fn agent_row(&self, tone: usize, state: FaceState, body: Div, key: &str) -> Div {
        div()
            .flex()
            .gap(px(space::X2_5))
            .child(
                div().pt(px(space::X0_5)).child(
                    AgentFace::new(SharedString::from(format!("face-{key}")), tone)
                        .size(20.)
                        .state(state),
                ),
            )
            .child(div().flex_1().min_w_0().child(body))
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
            .child(
                div()
                    .px(px(space::X6))
                    .pb(px(space::X4))
                    .pt(px(space::X2))
                    .max_w(px(760.))
                    .w_full()
                    .mx_auto()
                    .child(
                        layout::card(p)
                            .px(px(space::X3))
                            .py(px(space::X2))
                            .text_color(p.text)
                            .child(Textarea::new(&self.composer)),
                    ),
            )
    }
}

// A client id for `send` (idempotency): 16 random bytes as hex.
fn uuid() -> String {
    let mut bytes = [0u8; 16];
    getrandom::fill(&mut bytes).expect("the system's random source");
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}
