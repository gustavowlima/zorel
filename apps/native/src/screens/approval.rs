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

use crate::ui::space;
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

/// One card: the face and who asks (where, outside its chat), the kind as a quiet pill on the right, then the body
/// and actions the caller adds. Soft and roomy: the surface tone, a hairline, comfortable padding.
pub fn item(
    p: &Palette,
    kind: &str,
    kind_colors: (Rgba, Rgba),
    face: AnyElement,
    who: String,
    context: Option<String>,
) -> Div {
    layout::card(p)
        .flex()
        .flex_col()
        .gap(px(space::X3))
        .px(px(space::X4))
        .py(px(space::X3))
        .child(
            div()
                .flex()
                .items_center()
                .gap(px(space::X2_5))
                .child(face)
                .child(
                    div()
                        .flex()
                        .items_baseline()
                        .gap(px(space::X2))
                        .flex_1()
                        .min_w_0()
                        .child(div().flex_none().text_sm().font_weight(FontWeight::MEDIUM).child(who))
                        .when_some(context, |d, c| {
                            d.child(div().min_w_0().truncate().text_sm().text_color(p.text_muted).child(c))
                        }),
                )
                .child(
                    div()
                        .flex_none()
                        .rounded_full()
                        .px(px(space::X2))
                        .py(px(space::X0_5))
                        .text_xs()
                        .font_weight(FontWeight::MEDIUM)
                        .bg(kind_colors.0)
                        .text_color(kind_colors.1)
                        .child(t!(format!("inbox.kind.{kind}")).into_owned()),
                ),
        )
}

/// The ready answers a question offers (its args' `options`), if any.
fn options_of(a: &Approval) -> Vec<String> {
    serde_json::from_str::<serde_json::Value>(&a.args)
        .ok()
        .and_then(|v| v["options"].as_array().cloned())
        .unwrap_or_default()
        .iter()
        .filter_map(|o| o.as_str().map(str::to_string))
        .filter(|o| !o.trim().is_empty())
        .collect()
}

/// The card for one approval; `answer` is the question's answer box (a question only). `open` (outside the chat)
/// adds the chat's name and "Open the chat"; inside it, neither is needed.
pub fn card(
    a: &Approval,
    store: &Store,
    answer: Option<&Entity<TextareaState>>,
    decide: Decide,
    open: Option<OpenChat>,
    window: &Window,
) -> Div {
    let p = theme::palette(window);
    let question = is_question(a);
    let name = store.agent_name(a.agent_id.as_deref());
    let tone = store.tone(a.agent_id.as_deref());
    let who = if question {
        t!("question.label", agent = name).into_owned()
    } else {
        name
    };
    let context = open.as_ref().map(|_| {
        store
            .chat(&a.chat_id)
            .map(crate::labels::chat_title)
            .unwrap_or_default()
    });
    let face = AgentFace::new(SharedString::from(format!("approval-face-{}", a.id)), tone)
        .size(24.)
        .state(FaceState::Waiting)
        .into_any_element();
    let (kind, colors) = if question {
        ("question", (p.accent_soft, p.accent_text))
    } else {
        ("approval", (p.wait_soft, p.warning))
    };
    let card = item(p, kind, colors, face, who, context);
    let open_button = open.map(|open| {
        let chat_id = a.chat_id.clone();
        Button::new(
            SharedString::from(format!("open-{}", a.id)),
            t!("inbox.openChat").into_owned(),
        )
        .variant(Variant::Ghost)
        .size(Size::Sm)
        .on_click(move |_, window, cx| open(chat_id.clone(), window, cx))
    });
    let action =
        |key: &str, label: String, variant: Variant, outcome: &'static str, reason: Option<Entity<TextareaState>>| {
            let (id, decide) = (a.id.clone(), decide.clone());
            Button::new(SharedString::from(format!("{key}-{}", a.id)), label)
                .variant(variant)
                .size(Size::Sm)
                .on_click(move |_, window, cx| {
                    let text = reason.as_ref().map(|r| r.read(cx).value().trim().to_string());
                    // An empty answer isn't an answer.
                    if outcome == "approved" && text.as_deref() == Some("") {
                        return;
                    }
                    decide(id.clone(), outcome, text, window, cx)
                })
        };
    match (question, answer) {
        (true, Some(answer)) => {
            let options = options_of(a);
            let pills = options.iter().enumerate().map(|(n, o)| {
                let (id, decide, o) = (a.id.clone(), decide.clone(), o.clone());
                Button::new(SharedString::from(format!("option-{}-{n}", a.id)), o.clone())
                    .variant(Variant::Secondary)
                    .size(Size::Sm)
                    .round()
                    .on_click(move |_, window, cx| decide(id.clone(), "approved", Some(o.clone()), window, cx))
            });
            card.child(
                div()
                    .text_size(px(15.))
                    .line_height(px(22.))
                    .font_weight(FontWeight::MEDIUM)
                    .child(a.summary.clone()),
            )
            .when(!options.is_empty(), |c| {
                c.child(div().flex().flex_wrap().gap(px(space::X1_5)).children(pills))
            })
            // The answer on one line with its actions; it grows as you write.
            .child(
                div()
                    .flex()
                    .items_end()
                    .gap(px(space::X2))
                    .child(
                        div()
                            .flex_1()
                            .min_w_0()
                            .px(px(space::X3))
                            .py(px(space::X1_5))
                            .rounded(px(crate::theme::tokens::RADIUS_CONTROL))
                            .bg(p.bg_field)
                            .border_1()
                            .border_color(p.border)
                            .child(Textarea::new(answer)),
                    )
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
            )
            .children(open_button.map(|b| div().flex().child(b)))
        }
        _ => {
            let body = match a.kind {
                ApprovalKind::Command => code_block(p, a.summary.chars().take(2000).collect::<String>()),
                _ => div()
                    .flex()
                    .flex_col()
                    .gap(px(space::X1))
                    .child(div().font_weight(FontWeight::MEDIUM).child(a.summary.clone()))
                    .child(div().text_sm().text_color(p.text_muted).child(a.tool.clone())),
            };
            card.child(body).child(
                div()
                    .flex()
                    .items_center()
                    .gap(px(space::X2))
                    .children(open_button)
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
