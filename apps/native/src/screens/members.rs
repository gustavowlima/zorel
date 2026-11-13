// Who is in a chat (apps/web/src/features/people.tsx › TeamPicker), as reusable pieces: the header's faces (the
// members overlapping, the lead's carrying the chat's state: working, waiting, failed; or "+ Add an agent"), which
// open a list (Picker): the members, a name opening that agent's session drawer (screens/chat/crew.rs), and who can join: the agents in reach not
// here yet (a search past 8) and the teams (one press adds the members not here yet, up to 8 in all; what didn't fit
// is said).
use std::rc::Rc;

use gpui_kit::{
    assets::IconName,
    component::input::{Input, InputState},
    prelude::FluentBuilder,
    *,
};
use rust_i18n::t;

use crate::{
    i18n::tn,
    net::types::Agent,
    screens::{chat_actions, sidebar::face_state},
    state::{
        crew::{self, CHAT_MEMBERS_MAX},
        store::Store,
    },
    theme::{self, tokens},
    ui::{
        face::{AgentFace, FaceState},
        icon::{self, icon},
        motion, space,
    },
};

/// Past this many candidates the list gets a search field.
const SEARCH_AT: usize = 8;

/// What adding a team does: the chat's members then, who joins, how many didn't fit.
#[derive(Debug, PartialEq)]
pub struct TeamAdd {
    pub ids: Vec<String>,
    pub added: Vec<String>,
    pub overflow: usize,
}

/// The web's withTeam: the team's members in reach and not here yet join in its order, up to what a chat holds.
pub fn with_team(team: &[String], callable: &[&str], members: &[String]) -> TeamAdd {
    let fresh: Vec<String> = team
        .iter()
        .filter(|id| callable.contains(&id.as_str()) && !members.contains(id))
        .cloned()
        .collect();
    let room = CHAT_MEMBERS_MAX.saturating_sub(members.len());
    let added: Vec<String> = fresh.iter().take(room).cloned().collect();
    TeamAdd {
        ids: members.iter().cloned().chain(added.iter().cloned()).collect(),
        overflow: fresh.len().saturating_sub(room),
        added,
    }
}

/// The agents that could join: teammates of this chat's project (or global) not in it yet.
pub fn candidates<'a>(store: &'a Store, chat_id: &str) -> Vec<&'a Agent> {
    let Some(chat) = store.chat(chat_id) else {
        return Vec::new();
    };
    crew::callable(&store.agents, chat.project_id.as_deref())
        .into_iter()
        .filter(|a| !chat.agent_ids.contains(&a.id))
        .collect()
}

pub type OnOpen = Rc<dyn Fn(&mut Window, &mut App) + 'static>;
/// An agent of the chat picked in the list: open its session.
pub type OnSession = Rc<dyn Fn(String, &mut Window, &mut App) + 'static>;

/// The header's pill: the members' faces overlapping, or "+ Add an agent". It opens the crew drawer.
#[derive(IntoElement)]
pub struct Faces {
    store: Entity<Store>,
    chat_id: String,
    open: bool,
    on_open: Option<OnOpen>,
}

impl gpui_kit::component::Selectable for Faces {
    fn selected(mut self, selected: bool) -> Self {
        self.open = selected;
        self
    }

    fn is_selected(&self) -> bool {
        self.open
    }
}

impl Faces {
    pub fn new(store: Entity<Store>, chat_id: impl Into<String>, open: bool, on_open: OnOpen) -> Self {
        Self {
            store,
            chat_id: chat_id.into(),
            open,
            on_open: Some(on_open),
        }
    }

    /// As a popover's trigger: the popover opens on the press.
    fn trigger(store: Entity<Store>, chat_id: impl Into<String>) -> Self {
        Self {
            store,
            chat_id: chat_id.into(),
            open: false,
            on_open: None,
        }
    }
}

impl RenderOnce for Faces {
    fn render(self, window: &mut Window, cx: &mut App) -> impl IntoElement {
        let p = theme::palette(window);
        let id = ElementId::from(SharedString::from(format!("faces-{}", self.chat_id)));
        let (faces, names, lead) = {
            let store = self.store.read(cx);
            let Some(chat) = store.chat(&self.chat_id) else {
                return div().into_any_element();
            };
            let members: Vec<&Agent> = chat.agent_ids.iter().filter_map(|id| store.agent(id)).collect();
            let faces: Vec<(String, usize)> = members
                .iter()
                .map(|a| (a.id.clone(), store.tone(Some(&a.id))))
                .collect();
            let names = members.iter().map(|a| a.name.clone()).collect::<Vec<_>>().join(", ");
            (faces, names, face_state(store.status(&self.chat_id)))
        };
        let pointer = motion::pointer(&id, window, cx);
        let lit = pointer.read(cx).hovered || self.open;
        let bg = motion::color(
            &id,
            "bg",
            if lit {
                p.bg_control_hover
            } else {
                motion::fade(p.bg_control_hover, 0.)
            },
            window,
            cx,
        );
        let empty = faces.is_empty();
        let name = if empty {
            t!("team.add").into_owned()
        } else {
            t!("chat.members", names = names).into_owned()
        };
        let key = id.to_string();
        let on_open = self.on_open;
        let row = div()
            .id(id.clone())
            .role(Role::Button)
            .aria_label(SharedString::from(name))
            .aria_expanded(self.open)
            .flex()
            .flex_none()
            .items_center()
            .gap(px(space::X1_5))
            .h(px(tokens::CONTROL_H_SM))
            .px(px(space::X1_5))
            .rounded_full()
            .bg(bg)
            .text_sm()
            .text_color(p.text_muted)
            .when(empty, |r| {
                r.child(icon(IconName::Plus, icon::XS))
                    .child(t!("team.add").into_owned())
            })
            .when(!empty, |r| {
                r.child(div().flex().children(faces.iter().enumerate().map(|(i, (id, tone))| {
                    div()
                        .when(i > 0, |d| d.ml(px(-6.)))
                        .rounded_full()
                        .border_2()
                        .border_color(p.bg_canvas)
                        .child(
                            AgentFace::new(SharedString::from(format!("{key}-{id}")), *tone)
                                .size(20.)
                                .state(if i == 0 { lead } else { FaceState::Idle }),
                        )
                })))
            })
            .when_some(on_open, |r, open| r.on_click(move |_, window, cx| open(window, cx)));
        motion::track(row, &pointer).into_any_element()
    }
}

/// Who answers (the web's TeamPicker): the faces open a list of the members (the lead badged, Make lead and × on the
/// others; a member's name opens its session in this chat), then who can join (agents, teams) and the @ hint.
#[derive(IntoElement)]
pub struct Picker {
    store: Entity<Store>,
    chat_id: String,
    on_session: OnSession,
}

impl Picker {
    pub fn new(store: Entity<Store>, chat_id: impl Into<String>, on_session: OnSession) -> Self {
        Self {
            store,
            chat_id: chat_id.into(),
            on_session,
        }
    }
}

impl RenderOnce for Picker {
    fn render(self, _: &mut Window, _: &mut App) -> impl IntoElement {
        let (store, chat_id, on_session) = (self.store, self.chat_id, self.on_session);
        gpui_kit::component::popover::Popover::new(SharedString::from(format!("team-picker-{chat_id}")))
            .anchor(Anchor::TopRight)
            .offset(px(6.))
            .appearance(false)
            .trigger(Faces::trigger(store.clone(), chat_id.clone()))
            .content(move |_, window, cx| {
                let popover = cx.entity();
                let dismiss: OnOpen = Rc::new(move |window, cx| popover.update(cx, |s, cx| s.dismiss(window, cx)));
                list(&store, &chat_id, on_session.clone(), dismiss, window, cx)
            })
    }
}

/// The picker's list.
fn list(
    store: &Entity<Store>,
    chat_id: &str,
    on_session: OnSession,
    dismiss: OnOpen,
    window: &mut Window,
    cx: &mut App,
) -> AnyElement {
    let p = theme::palette(window);
    let (ids, members) = {
        let s = store.read(cx);
        let Some(chat) = s.chat(chat_id) else {
            return div().into_any_element();
        };
        let members: Vec<(Agent, usize, String)> = chat
            .agent_ids
            .iter()
            .filter_map(|id| s.agent(id))
            .enumerate()
            .map(|(i, a)| {
                let hint = if i == 0 {
                    t!("team.leadHint").into_owned()
                } else {
                    format!(
                        "@{} · {}",
                        crew::handle_of(&a.name),
                        crate::labels::model_name(&a.model, &s.models)
                    )
                };
                (a.clone(), s.tone(Some(&a.id)), hint)
            })
            .collect();
        (chat.agent_ids.clone(), members)
    };
    let heading = |text: String, rule: bool| {
        div()
            .px(px(space::X2))
            .pt(px(if rule { space::X2_5 } else { space::X1 }))
            .pb(px(space::X1_5))
            .when(rule, |d| d.mt(px(space::X1)).border_t_1().border_color(p.border))
            .text_sm()
            .font_weight(FontWeight::MEDIUM)
            .text_color(p.text_muted)
            .child(text)
            .into_any_element()
    };
    let many = members.len() > 1;
    let mut rows: Vec<AnyElement> = Vec::new();
    for (i, (a, tone, hint)) in members.iter().enumerate() {
        let action: AnyElement = if i == 0 {
            let hue = crate::ui::face::hue(p, *tone);
            div()
                .flex_none()
                .flex()
                .items_center()
                .h(px(20.))
                .px(px(space::X2))
                .rounded_full()
                .border_1()
                .border_color(crate::ui::face::mix(hue, 0.35, p.bg_surface))
                .bg(crate::ui::face::mix(hue, 0.12, p.bg_surface))
                .text_xs()
                .font_weight(FontWeight::MEDIUM)
                .child(t!("team.lead").into_owned())
                .into_any_element()
        } else {
            // The lead's model drives the chat, so it follows the new lead.
            let order: Vec<String> = std::iter::once(a.id.clone())
                .chain(ids.iter().filter(|x| **x != a.id).cloned())
                .collect();
            let (store, chat_id, model) = (store.clone(), chat_id.to_string(), a.model.clone());
            crate::ui::button::Button::new(
                SharedString::from(format!("picker-lead-{}", a.id)),
                t!("team.makeLead").into_owned(),
            )
            .variant(crate::ui::button::Variant::Ghost)
            .size(crate::ui::button::Size::Sm)
            .on_click(move |_, _, cx| chat_actions::set_team(&store, &chat_id, order.clone(), Some(model.clone()), cx))
            .into_any_element()
        };
        // A chat always keeps one agent: the last one can't be removed, only swapped for another.
        let remove = many.then(|| {
            let rest: Vec<String> = ids.iter().filter(|x| **x != a.id).cloned().collect();
            let (store, chat_id) = (store.clone(), chat_id.to_string());
            crate::ui::button::Button::icon_only(
                SharedString::from(format!("picker-remove-{}", a.id)),
                IconName::X,
                t!("team.removeMember", name = a.name).into_owned(),
            )
            .size(crate::ui::button::Size::Xs)
            .on_click(move |_, _, cx| chat_actions::set_team(&store, &chat_id, rest.clone(), None, cx))
        });
        // The face and name open the agent's session (the buttons beside them keep their own presses).
        let id = ElementId::from(SharedString::from(format!("picker-open-{}", a.id)));
        let pointer = motion::pointer(&id, window, cx);
        let bg = motion::color(
            &id,
            "bg",
            if pointer.read(cx).hovered {
                p.bg_control
            } else {
                motion::fade(p.bg_control, 0.)
            },
            window,
            cx,
        );
        let (open, dismiss, agent) = (on_session.clone(), dismiss.clone(), a.id.clone());
        let who = div()
            .id(id)
            .role(Role::Button)
            .aria_label(SharedString::from(t!("team.session").into_owned() + " · " + &a.name))
            .flex()
            .flex_1()
            .min_w_0()
            .items_center()
            .gap(px(space::X2_5))
            .px(px(space::X2))
            .py(px(space::X1_5))
            .rounded(px(tokens::RADIUS_ROW))
            .bg(bg)
            .child(AgentFace::new(SharedString::from(format!("picker-face-{}", a.id)), *tone).size(20.))
            .child(
                div()
                    .flex()
                    .flex_col()
                    .flex_1()
                    .min_w_0()
                    .child(div().truncate().font_weight(FontWeight::MEDIUM).child(a.name.clone()))
                    .child(div().truncate().text_sm().text_color(p.text_muted).child(hint.clone())),
            )
            .on_click(move |_, window, cx| {
                dismiss(window, cx);
                open(agent.clone(), window, cx);
            });
        rows.push(
            div()
                .flex()
                .items_center()
                .gap(px(space::X1))
                .pr(px(space::X1))
                .child(motion::track(who, &pointer))
                .child(action)
                .children(remove)
                .into_any_element(),
        );
    }
    let agents = agents_to_add(store, chat_id, window, cx);
    if !agents.is_empty() {
        rows.push(heading(t!("team.add").into_owned(), !members.is_empty()));
        rows.extend(agents);
    }
    let teams = teams_to_add(store, chat_id, window, cx);
    if !teams.is_empty() {
        rows.push(heading(t!("teams.addTeam").into_owned(), true));
        rows.extend(teams);
    }
    if many {
        rows.push(
            div()
                .px(px(space::X2))
                .pt(px(space::X2))
                .pb(px(space::X1))
                .text_sm()
                .text_color(p.text_dim)
                .child(t!("team.mentionHint").into_owned())
                .into_any_element(),
        );
    }
    crate::ui::layout::panel(SharedString::from(format!("team-list-{chat_id}")), p)
        .w(px(320.))
        .max_h(px(480.))
        .overflow_y_scroll()
        .flex()
        .flex_col()
        .gap(px(space::X0_5))
        .children(rows)
        .into_any_element()
}

/// The agents that could join, each a row with a +; a search field on top past 8.
pub fn agents_to_add(store: &Entity<Store>, chat_id: &str, window: &mut Window, cx: &mut App) -> Vec<AnyElement> {
    let p = theme::palette(window);
    let key = format!("join-{chat_id}");
    let (ids, candidates) = {
        let s = store.read(cx);
        let Some(chat) = s.chat(chat_id) else {
            return Vec::new();
        };
        let candidates: Vec<(Agent, usize)> = candidates(s, chat_id)
            .into_iter()
            .map(|a| (a.clone(), s.tone(Some(&a.id))))
            .collect();
        (chat.agent_ids.clone(), candidates)
    };
    if candidates.is_empty() {
        return Vec::new();
    }
    let query = (candidates.len() > SEARCH_AT).then(|| {
        window.use_keyed_state(SharedString::from(format!("{key}-search")), cx, |window, cx| {
            InputState::new(window, cx).placeholder(t!("agents.search").into_owned())
        })
    });
    let typed = query
        .as_ref()
        .map(|q| q.read(cx).value().trim().to_lowercase())
        .unwrap_or_default();
    let mut rows: Vec<AnyElement> = Vec::new();
    if let Some(q) = query {
        rows.push(
            div()
                .flex()
                .flex_none()
                .items_center()
                .gap(px(space::X2))
                .h(px(tokens::CONTROL_H_SM))
                .px(px(space::X2_5))
                .rounded(px(tokens::RADIUS_CONTROL_SM))
                .bg(p.bg_field)
                .text_sm()
                .child(icon(IconName::Search, icon::SM).text_color(p.text_muted))
                .child(div().flex_1().child(Input::new(&q).appearance(false)))
                .into_any_element(),
        );
    }
    let first = ids.is_empty();
    let shown: Vec<&(Agent, usize)> = candidates
        .iter()
        .filter(|(a, _)| {
            typed.is_empty()
                || format!("{} {} {}", a.name, crew::handle_of(&a.name), a.title)
                    .to_lowercase()
                    .contains(&typed)
        })
        .collect();
    if shown.is_empty() {
        rows.push(
            div()
                .px(px(space::X2))
                .py(px(space::X1_5))
                .text_sm()
                .text_color(p.text_muted)
                .child(t!("agents.noMatch").into_owned())
                .into_any_element(),
        );
    }
    for (a, tone) in shown {
        let joined: Vec<String> = ids.iter().cloned().chain(std::iter::once(a.id.clone())).collect();
        let (store, chat_id) = (store.clone(), chat_id.to_string());
        // The first one in also brings the chat its model.
        let model = first.then(|| a.model.clone());
        rows.push(
            pick_row(
                SharedString::from(format!("{key}-add-{}", a.id)),
                AgentFace::new(SharedString::from(format!("{key}-face-{}", a.id)), *tone)
                    .size(20.)
                    .into_any_element(),
                a.name.clone(),
                (!a.title.is_empty()).then(|| a.title.clone()),
                false,
                window,
                cx,
            )
            .on_click(move |_, _, cx| chat_actions::set_team(&store, &chat_id, joined.clone(), model.clone(), cx))
            .into_any_element(),
        );
    }
    rows
}

/// The teams that could join: one press adds whoever isn't here yet (up to 8 in all), then says what didn't fit.
pub fn teams_to_add(store: &Entity<Store>, chat_id: &str, window: &mut Window, cx: &mut App) -> Vec<AnyElement> {
    let p = theme::palette(window);
    let key = format!("join-{chat_id}");
    let overflow = window.use_keyed_state(SharedString::from(format!("{key}-overflow")), cx, |_, _| 0usize);
    struct Team {
        id: String,
        name: String,
        add: TeamAdd,
        hint: String,
        model: Option<String>,
    }
    let teams: Vec<Team> = {
        let s = store.read(cx);
        let Some(chat) = s.chat(chat_id) else {
            return Vec::new();
        };
        let callable: Vec<&str> = crew::callable(&s.agents, chat.project_id.as_deref())
            .iter()
            .map(|a| a.id.as_str())
            .collect();
        let first = chat.agent_ids.is_empty();
        crew::teams_in(&s.teams, chat.project_id.as_deref())
            .into_iter()
            .map(|team| {
                let add = with_team(&team.agent_ids, &callable, &chat.agent_ids);
                let hint = if add.added.is_empty() {
                    t!("teams.allIn").into_owned()
                } else {
                    let names: Vec<String> = add.added.iter().map(|id| s.agent_name(Some(id))).collect();
                    t!("teams.added", names = names.join(", ")).into_owned()
                };
                let model = first
                    .then(|| add.added.first().and_then(|id| s.agent(id)).map(|a| a.model.clone()))
                    .flatten();
                Team {
                    id: team.id.clone(),
                    name: team.name.clone(),
                    add,
                    hint,
                    model,
                }
            })
            .collect()
    };
    let mut rows: Vec<AnyElement> = Vec::new();
    for team in teams {
        let done = team.add.added.is_empty();
        let row = pick_row(
            SharedString::from(format!("{key}-team-{}", team.id)),
            icon(IconName::Users, icon::MD)
                .text_color(p.text_muted)
                .into_any_element(),
            team.name,
            Some(team.hint),
            done,
            window,
            cx,
        );
        rows.push(if done {
            row.into_any_element()
        } else {
            let (store, chat_id, overflow) = (store.clone(), chat_id.to_string(), overflow.clone());
            let (ids, spill, model) = (team.add.ids, team.add.overflow, team.model);
            row.on_click(move |_, _, cx| {
                overflow.update(cx, |o, cx| {
                    *o = spill;
                    cx.notify();
                });
                chat_actions::set_team(&store, &chat_id, ids.clone(), model.clone(), cx)
            })
            .into_any_element()
        });
    }
    let spilled = *overflow.read(cx);
    if spilled > 0 && !rows.is_empty() {
        rows.push(
            div()
                .px(px(space::X2))
                .text_sm()
                .text_color(p.warning)
                .child(tn("teams.overflow", spilled as i64))
                .into_any_element(),
        );
    }
    rows
}

/// A row that adds someone: its mark, its name (and a hint under it), a + at the end.
fn pick_row(
    id: SharedString,
    mark: AnyElement,
    name: String,
    hint: Option<String>,
    disabled: bool,
    window: &mut Window,
    cx: &mut App,
) -> Stateful<Div> {
    let p = theme::palette(window);
    let id = ElementId::from(id);
    let pointer = motion::pointer(&id, window, cx);
    let hovered = pointer.read(cx).hovered && !disabled;
    let bg = motion::color(
        &id,
        "bg",
        if hovered {
            p.bg_control
        } else {
            motion::fade(p.bg_control, 0.)
        },
        window,
        cx,
    );
    let row = div()
        .id(id.clone())
        .role(Role::Button)
        .aria_label(SharedString::from(name.clone()))
        .flex()
        .flex_none()
        .items_center()
        .gap(px(space::X2_5))
        .px(px(space::X2))
        .py(px(space::X1_5))
        .rounded(px(tokens::RADIUS_ROW))
        .bg(bg)
        .when(disabled, |r| r.opacity(0.45))
        .child(mark)
        .child(
            div()
                .flex()
                .flex_col()
                .flex_1()
                .min_w_0()
                .child(div().truncate().child(name))
                .when_some(hint, |c, h| {
                    c.child(div().truncate().text_sm().text_color(p.text_muted).child(h))
                }),
        )
        .child(icon(IconName::Plus, icon::XS).text_color(p.text_muted));
    motion::track(row, &pointer)
}

#[cfg(test)]
mod tests {
    use super::{TeamAdd, with_team};

    fn ids(v: &[&str]) -> Vec<String> {
        v.iter().map(|s| s.to_string()).collect()
    }

    #[test]
    fn a_team_adds_whoever_is_in_reach_and_not_here_up_to_eight() {
        let callable = ["a1", "a2", "a3", "x", "y", "z", "w", "v", "u"];
        let team = ids(&["a1", "a2", "a3", "gone"]);
        assert_eq!(
            with_team(&team, &callable, &ids(&["a1", "a2"])),
            TeamAdd {
                ids: ids(&["a1", "a2", "a3"]),
                added: ids(&["a3"]),
                overflow: 0
            }
        );
        let full = with_team(
            &ids(&["a2", "a3"]),
            &callable,
            &ids(&["a1", "x", "y", "z", "w", "v", "u"]),
        );
        assert_eq!((full.added, full.overflow), (ids(&["a2"]), 1));
        assert_eq!(with_team(&[], &callable, &[]).ids, Vec::<String>::new());
    }
}
