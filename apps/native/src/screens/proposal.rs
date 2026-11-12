// The Builder's pieces in its conversation (apps/web/src/features/builder.tsx): the intro before the first message
// (its face, what to say, a few starting points) and its proposal as a card after its turn: each proposed agent's
// face, name, role and "proposed by the Builder", what it does, its model and access; Create (as proposed or as
// edited), Edit first (model and access, inline) and Discard. Pure drawing: the chat screen owns the state and passes
// what each button does.
use std::rc::Rc;

use gpui_kit::{assets::IconName, prelude::FluentBuilder, *};
use rust_i18n::t;

use crate::{
    i18n::tn,
    net::types::{Agent, ProposedAgent, ProposedAgentAccess},
    theme,
    ui::{
        button::{Button, Size, Variant},
        face::AgentFace,
        layout,
        segmented::{self, Segmented},
        space,
    },
};

/// The starting points the intro offers (the web's).
pub const SUGGESTIONS: [&str; 4] = [
    "builder.suggest.review",
    "builder.suggest.triage",
    "builder.suggest.docs",
    "builder.suggest.team",
];

pub type Pick = Rc<dyn Fn(String, &mut Window, &mut App) + 'static>;
pub type Act = Rc<dyn Fn(&mut Window, &mut App) + 'static>;
pub type OnIndex = Rc<dyn Fn(usize, &mut Window, &mut App) + 'static>;
pub type OnAccess = Rc<dyn Fn(usize, ProposedAgentAccess, &mut Window, &mut App) + 'static>;

/// Before the first message: the Builder (face, name), what to say, the starting points.
pub fn intro(builder: Option<&Agent>, tone: usize, pick: Pick, window: &Window) -> AnyElement {
    let p = theme::palette(window);
    let name = builder.map_or_else(|| t!("builder.title").into_owned(), |b| b.name.clone());
    div()
        .flex()
        .flex_col()
        .items_center()
        .gap(px(space::X5))
        .pt(px(space::X14))
        .text_center()
        .child(AgentFace::new("builder-intro-face", tone).size(64.))
        .child(
            div()
                .flex()
                .flex_col()
                .items_center()
                .gap(px(space::X1_5))
                .max_w(px(420.))
                .child(div().text_size(px(17.)).font_weight(FontWeight::SEMIBOLD).child(name))
                .child(
                    div()
                        .text_color(p.text_muted)
                        .child(t!("builder.introBody").into_owned()),
                ),
        )
        .child(
            div()
                .flex()
                .flex_wrap()
                .justify_center()
                .gap(px(space::X1_5))
                .children(SUGGESTIONS.iter().map(|key| {
                    let (text, pick) = (t!(*key).into_owned(), pick.clone());
                    Button::new(SharedString::from(format!("suggest-{key}")), text.clone())
                        .size(Size::Sm)
                        .round()
                        .on_click(move |_, window, cx| pick(text.clone(), window, cx))
                })),
        )
        .into_any_element()
}

/// What a proposed agent looks like once edited here (None: as proposed).
#[derive(Clone, Default)]
pub struct Edit {
    pub model: Option<crate::screens::model_picker::ModelChoice>,
    pub access: Option<ProposedAgentAccess>,
}

pub struct Card<'a> {
    pub drafts: &'a [ProposedAgent],
    pub edits: &'a [Edit],
    /// Which draft shows its editor (its model picker and access).
    pub editing: Option<usize>,
    pub pickers: Vec<Option<AnyElement>>,
    /// Hues for the proposed faces (after the existing agents', so they don't repeat).
    pub first_tone: usize,
    pub busy: bool,
    pub models: &'a [crate::net::types::ModelInfo],
    pub on_create: Act,
    pub on_discard: Act,
    pub on_edit: OnIndex,
    pub on_access: OnAccess,
}

const ACCESS: [(ProposedAgentAccess, &str); 3] = [
    (ProposedAgentAccess::Workspace, "access.workspace"),
    (ProposedAgentAccess::Ask, "access.ask"),
    (ProposedAgentAccess::Full, "access.full"),
];

fn access_key(a: ProposedAgentAccess) -> &'static str {
    ACCESS
        .iter()
        .find(|(x, _)| *x == a)
        .map_or("access.workspace", |(_, k)| k)
}

/// The proposal: one card per proposed agent, then Create · Edit first · Discard for all of them.
pub fn card(c: Card, window: &Window) -> AnyElement {
    let p = theme::palette(window);
    let team = c.drafts.len() > 1;
    let mut pickers = c.pickers;
    let members: Vec<AnyElement> = c
        .drafts
        .iter()
        .enumerate()
        .map(|(i, d)| {
            let edit = c.edits.get(i).cloned().unwrap_or_default();
            let model = edit.model.as_ref().map_or(d.model.clone(), |m| m.model.clone());
            let access = edit.access.unwrap_or(d.access);
            let facts = format!(
                "{} · {}",
                crate::labels::model_name(&model, c.models),
                t!(access_key(access))
            );
            let editing = c.editing == Some(i);
            let (on_edit, on_access) = (c.on_edit.clone(), c.on_access.clone());
            let picker = pickers.get_mut(i).and_then(Option::take);
            layout::card(p)
                .p(px(space::X4))
                .flex()
                .flex_col()
                .gap(px(space::X3))
                .child(
                    div()
                        .flex()
                        .items_center()
                        .gap(px(space::X3))
                        .child(
                            AgentFace::new(SharedString::from(format!("draft-face-{i}")), c.first_tone + i).size(36.),
                        )
                        .child(
                            div()
                                .flex()
                                .flex_col()
                                .flex_1()
                                .min_w_0()
                                .child(div().font_weight(FontWeight::SEMIBOLD).truncate().child(d.name.clone()))
                                .child(div().text_sm().text_color(p.text_muted).truncate().child(format!(
                                    "{} · {}",
                                    d.title,
                                    t!("builder.proposedBy")
                                ))),
                        )
                        .child(
                            Button::icon_only(
                                SharedString::from(format!("draft-edit-{i}")),
                                IconName::Pencil,
                                t!("builder.editFirst").into_owned(),
                            )
                            .size(Size::Sm)
                            .on_click(move |_, window, cx| on_edit(i, window, cx)),
                        ),
                )
                .when(!d.description.is_empty(), |c| {
                    c.child(
                        div()
                            .text_color(p.text_secondary)
                            .line_clamp(3)
                            .child(d.description.clone()),
                    )
                })
                .child(div().text_sm().text_color(p.text_muted).child(facts))
                // Edit first, inline: its AI and how far it may act.
                .when(editing, |c| {
                    let selected = ACCESS.iter().position(|(x, _)| *x == access).unwrap_or(0);
                    let pick: segmented::OnPick = Rc::new(move |ix, window, cx| on_access(i, ACCESS[ix].0, window, cx));
                    c.child(
                        div()
                            .flex()
                            .flex_col()
                            .gap(px(space::X2))
                            .pt(px(space::X2))
                            .border_t_1()
                            .border_color(p.border)
                            .child(
                                div()
                                    .flex()
                                    .items_center()
                                    .justify_between()
                                    .gap(px(space::X3))
                                    .child(
                                        div()
                                            .text_sm()
                                            .text_color(p.text_muted)
                                            .child(t!("builder.model").into_owned()),
                                    )
                                    .children(picker),
                            )
                            .child(
                                div()
                                    .flex()
                                    .items_center()
                                    .justify_between()
                                    .gap(px(space::X3))
                                    .child(
                                        div()
                                            .text_sm()
                                            .text_color(p.text_muted)
                                            .child(t!("access.title").into_owned()),
                                    )
                                    .child(Segmented::new(
                                        SharedString::from(format!("draft-access-{i}")),
                                        t!("access.title").into_owned(),
                                        ACCESS.iter().map(|(_, k)| t!(*k).into_owned().into()).collect(),
                                        selected,
                                        pick,
                                    )),
                            ),
                    )
                })
                .into_any_element()
        })
        .collect();
    let (create, discard) = (c.on_create.clone(), c.on_discard.clone());
    let create_label = if team {
        tn("builder.createAll", c.drafts.len() as i64)
    } else {
        t!(
            "builder.createNamed",
            name = c.drafts.first().map(|d| d.name.as_str()).unwrap_or_default()
        )
        .into_owned()
    };
    div()
        .flex()
        .flex_col()
        .gap(px(space::X3))
        .when(team, |d| {
            d.child(
                div()
                    .text_color(p.text_muted)
                    .child(t!("builder.teamHint").into_owned()),
            )
        })
        .children(members)
        .child(
            div()
                .flex()
                .items_center()
                .gap(px(space::X2))
                .child(
                    Button::new("proposal-create", create_label)
                        .variant(Variant::Primary)
                        .size(Size::Sm)
                        .disabled(c.busy)
                        .on_click(move |_, window, cx| create(window, cx)),
                )
                .child(
                    Button::new("proposal-discard", t!("builder.discard").into_owned())
                        .variant(Variant::Ghost)
                        .size(Size::Sm)
                        .disabled(c.busy)
                        .on_click(move |_, window, cx| discard(window, cx)),
                ),
        )
        .into_any_element()
}

/// After a proposal: what this conversation made, each a row that starts a chat with it.
pub fn created(agents: &[(Agent, usize)], open: Pick, window: &Window) -> AnyElement {
    let p = theme::palette(window);
    let rows = agents.iter().map(|(a, tone)| {
        let (id, open) = (a.id.clone(), open.clone());
        crate::ui::nav::NavRow::new(SharedString::from(format!("made-{}", a.id)), a.name.clone())
            .leading(AgentFace::new(SharedString::from(format!("made-face-{}", a.id)), *tone).size(28.))
            .detail(
                if a.title.is_empty() {
                    a.model.clone()
                } else {
                    a.title.clone()
                },
                None,
            )
            .emphasis(true)
            .on_click(move |_, window, cx| open(id.clone(), window, cx))
    });
    layout::section(
        p,
        t!("builder.created").into_owned(),
        Some(t!("builder.createdHint").into_owned()),
        None,
        layout::rows(p).children(rows),
    )
    .into_any_element()
}

/// While the agents are being made.
pub fn creating(window: &Window) -> AnyElement {
    let p = theme::palette(window);
    div()
        .text_sm()
        .text_color(p.text_muted)
        .child(t!("builder.creating").into_owned())
        .into_any_element()
}
