// One open approval or question as a card (apps/web/src/features/inbox.tsx ApprovalItem): who waits, in which chat,
// the kind on the right; a command as code, a tool call as its summary and tool; a question with an answer box. Its
// actions are callbacks, so Needs you and Home share the very same card.
use std::rc::Rc;

use gpui_kit::{
    base::input::{Textarea, TextareaState},
    prelude::FluentBuilder,
    *,
};
use rust_i18n::t;

use crate::{
    net::types::{Approval, ApprovalKind},
    state::store::Store,
    theme::{self, tokens::Palette},
    ui::{
        button::{Button, Size, Variant},
        code::code_block,
        face::{AgentFace, FaceState},
        layout,
    },
};

/// Decide an approval: (approval id, "approved" | "always" | "denied", the answer or reason).
pub type Decide = Rc<dyn Fn(String, &'static str, Option<String>, &mut Window, &mut App) + 'static>;
/// Open a chat by id.
pub type OpenChat = Rc<dyn Fn(String, &mut Window, &mut App) + 'static>;

/// A question in words (zorel_ask_user); a routine's "Ask me" step is a yes or no, so it counts as an approval.
pub fn is_question(a: &Approval) -> bool {
    matches!(a.kind, ApprovalKind::Question) && a.run_step_id.is_none()
}

/// One card: who, where and when, the kind on the right, then the body and actions the caller adds.
pub fn item(p: &Palette, kind: &str, kind_colors: (Rgba, Rgba), face: AnyElement, who: String, context: String) -> Div {
    layout::card(p).flex().flex_col().gap(px(14.)).p(px(20.)).child(
        div()
            .flex()
            .items_start()
            .gap(px(12.))
            .child(face)
            .child(
                div()
                    .flex()
                    .flex_col()
                    .flex_1()
                    .min_w_0()
                    .child(div().font_weight(FontWeight::SEMIBOLD).truncate().child(who))
                    .child(div().text_sm().text_color(p.text_muted).truncate().child(context)),
            )
            .child(
                div()
                    .flex_none()
                    .rounded_full()
                    .px(px(8.))
                    .py(px(2.))
                    .text_xs()
                    .font_weight(FontWeight::MEDIUM)
                    .bg(kind_colors.0)
                    .text_color(kind_colors.1)
                    .child(t!(format!("inbox.kind.{kind}")).into_owned()),
            ),
    )
}

/// The card for one approval; `answer` is the question's answer box (a question only).
pub fn card(
    a: &Approval,
    store: &Store,
    answer: Option<&Entity<TextareaState>>,
    decide: Decide,
    open: OpenChat,
    window: &Window,
) -> Div {
    let p = theme::palette(window);
    let question = is_question(a);
    let (who, tone) = (
        store.agent_name(a.agent_id.as_deref()),
        store.tone(a.agent_id.as_deref()),
    );
    let context = store
        .chat(&a.chat_id)
        .map(crate::labels::chat_title)
        .unwrap_or_default();
    let face = AgentFace::new(SharedString::from(format!("approval-face-{}", a.id)), tone)
        .size(32.)
        .state(FaceState::Waiting)
        .into_any_element();
    let (kind, colors) = if question {
        ("question", (p.accent_soft, p.accent_text))
    } else {
        ("approval", (p.wait_soft, p.warning))
    };
    let card = item(p, kind, colors, face, who, context);
    let chat_id = a.chat_id.clone();
    let open_button = Button::new(
        SharedString::from(format!("open-{}", a.id)),
        t!("inbox.openChat").into_owned(),
    )
    .variant(Variant::Ghost)
    .size(Size::Sm)
    .on_click(move |_, window, cx| open(chat_id.clone(), window, cx));
    let action =
        |key: &str, label: String, variant: Variant, outcome: &'static str, reason: Option<Entity<TextareaState>>| {
            let (id, decide) = (a.id.clone(), decide.clone());
            Button::new(SharedString::from(format!("{key}-{}", a.id)), label)
                .variant(variant)
                .size(Size::Sm)
                .on_click(move |_, window, cx| {
                    let text = reason.as_ref().map(|r| r.read(cx).value().to_string());
                    decide(id.clone(), outcome, text, window, cx)
                })
        };
    match (question, answer) {
        (true, Some(answer)) => card
            .child(div().text_lg().child(a.summary.clone()))
            .child(
                layout::card(p)
                    .bg(p.bg_field)
                    .px(px(10.))
                    .py(px(6.))
                    .child(Textarea::new(answer)),
            )
            .child(
                div()
                    .flex()
                    .items_center()
                    .gap(px(8.))
                    .child(open_button)
                    .child(div().flex_1())
                    .child(action(
                        "skip",
                        t!("question.skip").into_owned(),
                        Variant::Ghost,
                        "denied",
                        None,
                    ))
                    .child(action(
                        "send",
                        t!("question.send").into_owned(),
                        Variant::Primary,
                        "approved",
                        Some(answer.clone()),
                    )),
            ),
        _ => {
            let body = match a.kind {
                ApprovalKind::Command => code_block(p, a.summary.chars().take(2000).collect::<String>()),
                _ => div().child(a.summary.clone()).child(
                    div()
                        .mt(px(6.))
                        .text_sm()
                        .text_color(p.text_muted)
                        .child(a.tool.clone()),
                ),
            };
            card.child(body).child(
                div()
                    .flex()
                    .items_center()
                    .gap(px(8.))
                    .child(open_button)
                    .child(div().flex_1())
                    .when(a.always_key.is_some(), |row| {
                        row.child(action(
                            "always",
                            t!("approval.allowAlways").into_owned(),
                            Variant::Ghost,
                            "always",
                            None,
                        ))
                    })
                    .child(action(
                        "deny",
                        t!("approval.deny").into_owned(),
                        Variant::Secondary,
                        "denied",
                        None,
                    ))
                    .child(action(
                        "allow",
                        t!("approval.allow").into_owned(),
                        Variant::Primary,
                        "approved",
                        None,
                    )),
            )
        }
    }
}
