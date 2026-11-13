// Who answers in a chat (apps/web/src/features/people.tsx › TeamPicker), in the chat's header: the members' faces
// overlapping (the lead's carries the chat's state: working, waiting, failed), or "+ Add an agent". It opens a list:
// the members (the lead badged, "Make lead" on the others, which also moves the chat to their model; × while more than
// one is left: a chat always keeps an agent), the agents that could join (a search past 8), the teams that could join
// (one press adds the members not here yet, up to 8 in all; what didn't fit is said), and the @ hint with several.
use gpui_kit::{
    assets::IconName,
    component::{
        Selectable,
        input::{Input, InputState},
        popover::Popover,
    },
    prelude::FluentBuilder,
    *,
};
use rust_i18n::t;

use crate::{
    i18n::tn,
    labels,
    net::types::{Agent, AgentTeam},
    screens::{chat_actions, sidebar::face_state},
    state::{
        crew::{self, CHAT_MEMBERS_MAX},
        store::Store,
    },
    theme::{self, tokens},
    ui::{
        face::{self, AgentFace, FaceState},
        icon::{self, icon},
        layout, motion, space,
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

#[derive(IntoElement)]
pub struct TeamPicker {
    store: Entity<Store>,
    chat_id: String,
}

impl TeamPicker {
    pub fn new(store: Entity<Store>, chat_id: impl Into<String>) -> Self {
        Self {
            store,
            chat_id: chat_id.into(),
        }
    }
}

impl RenderOnce for TeamPicker {
    fn render(self, _: &mut Window, cx: &mut App) -> impl IntoElement {
        let store = self.store.read(cx);
        let Some(chat) = store.chat(&self.chat_id) else {
            return div().into_any_element();
        };
        let members: Vec<&Agent> = chat.agent_ids.iter().filter_map(|id| store.agent(id)).collect();
        let candidates = candidates(store, &self.chat_id);
        let teams = crew::teams_in(&store.teams, chat.project_id.as_deref());
        // Nothing to show or pick (no agents at all; the first run makes one).
        if members.is_empty() && candidates.is_empty() && teams.is_empty() {
            return div().into_any_element();
        }
        let trigger = Trigger {
            id: SharedString::from(format!("team-{}", self.chat_id)).into(),
            faces: members
                .iter()
                .map(|a| (a.id.clone(), store.tone(Some(&a.id))))
                .collect(),
            names: members.iter().map(|a| a.name.clone()).collect::<Vec<_>>().join(", "),
            lead: face_state(store.status(&self.chat_id)),
            open: false,
        };
        let (store, chat_id) = (self.store, self.chat_id);
        Popover::new(SharedString::from(format!("team-picker-{chat_id}")))
            .anchor(Anchor::TopRight)
            .offset(px(6.))
            .appearance(false)
            .trigger(trigger)
            .content(move |_, window, cx| list(&store, &chat_id, window, cx))
            .into_any_element()
    }
}

/// The agents that could join: teammates of this chat's project (or global) not in it yet.
fn candidates<'a>(store: &'a Store, chat_id: &str) -> Vec<&'a Agent> {
    let Some(chat) = store.chat(chat_id) else {
        return Vec::new();
    };
    crew::callable(&store.agents, chat.project_id.as_deref())
        .into_iter()
        .filter(|a| !chat.agent_ids.contains(&a.id))
        .collect()
}

fn list(store: &Entity<Store>, chat_id: &str, window: &mut Window, cx: &mut App) -> AnyElement {
    let p = theme::palette(window);
    let key = format!("team-list-{chat_id}");
    let overflow = window.use_keyed_state(SharedString::from(format!("{key}-overflow")), cx, |_, _| 0usize);
    // A snapshot of what the list shows, so the rows below can use `cx` freely.
    struct Member {
        agent: Agent,
        tone: usize,
        hint: String,
    }
    struct Team {
        team: AgentTeam,
        add: TeamAdd,
        hint: String,
        model: Option<String>,
    }
    let (ids, members, candidates, teams) = {
        let s = store.read(cx);
        let Some(chat) = s.chat(chat_id) else {
            return div().into_any_element();
        };
        let members: Vec<Member> = chat
            .agent_ids
            .iter()
            .filter_map(|id| s.agent(id))
            .enumerate()
            .map(|(i, a)| Member {
                agent: a.clone(),
                tone: s.tone(Some(&a.id)),
                hint: if i == 0 {
                    t!("team.leadHint").into_owned()
                } else {
                    format!(
                        "@{} · {}",
                        crew::handle_of(&a.name),
                        labels::model_name(&a.model, &s.models)
                    )
                },
            })
            .collect();
        let candidates: Vec<(Agent, usize)> = candidates(s, chat_id)
            .into_iter()
            .map(|a| (a.clone(), s.tone(Some(&a.id))))
            .collect();
        let callable: Vec<&str> = crew::callable(&s.agents, chat.project_id.as_deref())
            .iter()
            .map(|a| a.id.as_str())
            .collect();
        let first = chat.agent_ids.is_empty();
        let teams: Vec<Team> = crew::teams_in(&s.teams, chat.project_id.as_deref())
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
                    team: team.clone(),
                    add,
                    hint,
                    model,
                }
            })
            .collect();
        (chat.agent_ids.clone(), members, candidates, teams)
    };
    let query = (candidates.len() > SEARCH_AT).then(|| {
        window.use_keyed_state(SharedString::from(format!("{key}-search")), cx, |window, cx| {
            let state = InputState::new(window, cx).placeholder(t!("agents.search").into_owned());
            state.focus_handle(cx).focus(window, cx);
            state
        })
    });
    let typed = query
        .as_ref()
        .map(|q| q.read(cx).value().trim().to_lowercase())
        .unwrap_or_default();
    let shown: Vec<&(Agent, usize)> = candidates
        .iter()
        .filter(|(a, _)| {
            typed.is_empty()
                || format!("{} {} {}", a.name, crew::handle_of(&a.name), a.title)
                    .to_lowercase()
                    .contains(&typed)
        })
        .collect();
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
    };
    let many = members.len() > 1;
    let member_rows: Vec<AnyElement> = members
        .iter()
        .enumerate()
        .map(|(i, m)| {
            let (a, tone, hint) = (&m.agent, m.tone, m.hint.clone());
            let action: AnyElement = if i == 0 {
                let hue = face::hue(p, tone);
                div()
                    .flex_none()
                    .flex()
                    .items_center()
                    .h(px(20.))
                    .px(px(space::X2))
                    .rounded_full()
                    .border_1()
                    .border_color(face::mix(hue, 0.35, p.bg_float))
                    .bg(face::mix(hue, 0.12, p.bg_float))
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
                    SharedString::from(format!("{key}-lead-{}", a.id)),
                    t!("team.makeLead").into_owned(),
                )
                .variant(crate::ui::button::Variant::Ghost)
                .size(crate::ui::button::Size::Sm)
                .on_click(move |_, _, cx| {
                    chat_actions::set_team(&store, &chat_id, order.clone(), Some(model.clone()), cx)
                })
                .into_any_element()
            };
            // A chat always keeps one agent: the last one can't be removed, only swapped for another.
            let remove = many.then(|| {
                let rest: Vec<String> = ids.iter().filter(|x| **x != a.id).cloned().collect();
                let (store, chat_id) = (store.clone(), chat_id.to_string());
                crate::ui::button::Button::icon_only(
                    SharedString::from(format!("{key}-remove-{}", a.id)),
                    IconName::X,
                    t!("team.removeMember", name = a.name).into_owned(),
                )
                .variant(crate::ui::button::Variant::Ghost)
                .size(crate::ui::button::Size::Xs)
                .on_click(move |_, _, cx| chat_actions::set_team(&store, &chat_id, rest.clone(), None, cx))
            });
            div()
                .flex()
                .items_center()
                .gap(px(space::X2_5))
                .px(px(space::X2))
                .py(px(space::X1_5))
                .child(AgentFace::new(SharedString::from(format!("{key}-face-{}", a.id)), tone).size(20.))
                .child(
                    div()
                        .flex()
                        .flex_col()
                        .flex_1()
                        .min_w_0()
                        .child(div().truncate().font_weight(FontWeight::MEDIUM).child(a.name.clone()))
                        .child(div().truncate().text_sm().text_color(p.text_muted).child(hint)),
                )
                .child(action)
                .children(remove)
                .into_any_element()
        })
        .collect();
    let first = ids.is_empty();
    let add_rows: Vec<AnyElement> = shown
        .iter()
        .map(|(a, tone)| {
            let joined: Vec<String> = ids.iter().cloned().chain(std::iter::once(a.id.clone())).collect();
            let (store, chat_id) = (store.clone(), chat_id.to_string());
            let model = first.then(|| a.model.clone());
            pick_row(
                SharedString::from(format!("{key}-add-{}", a.id)),
                AgentFace::new(SharedString::from(format!("{key}-cand-{}", a.id)), *tone)
                    .size(20.)
                    .into_any_element(),
                a.name.clone(),
                None,
                false,
                window,
                cx,
            )
            .on_click(move |_, _, cx| chat_actions::set_team(&store, &chat_id, joined.clone(), model.clone(), cx))
            .into_any_element()
        })
        .collect();
    let team_rows: Vec<AnyElement> = teams
        .iter()
        .map(|t| {
            let (team, add, hint, model) = (&t.team, &t.add, t.hint.clone(), t.model.clone());
            let (store, chat_id, ids, spill) = (store.clone(), chat_id.to_string(), add.ids.clone(), add.overflow);
            let overflow = overflow.clone();
            let row = pick_row(
                SharedString::from(format!("{key}-team-{}", team.id)),
                icon(IconName::Users, icon::MD)
                    .text_color(p.text_muted)
                    .into_any_element(),
                team.name.clone(),
                Some(hint),
                add.added.is_empty(),
                window,
                cx,
            );
            if add.added.is_empty() {
                row.into_any_element()
            } else {
                row.on_click(move |_, _, cx| {
                    overflow.update(cx, |o, cx| {
                        *o = spill;
                        cx.notify();
                    });
                    chat_actions::set_team(&store, &chat_id, ids.clone(), model.clone(), cx)
                })
                .into_any_element()
            }
        })
        .collect();
    let spilled = *overflow.read(cx);
    let panel = layout::panel(SharedString::from(key.clone()), p)
        .w(px(320.))
        .max_h(px(480.))
        .flex()
        .flex_col()
        .gap(px(space::X1))
        .p(px(space::X2))
        .overflow_y_scroll()
        .child(heading(t!("team.title").into_owned(), false))
        .when(members.is_empty() && candidates.is_empty(), |c| {
            c.child(
                div()
                    .px(px(space::X2))
                    .pb(px(space::X2))
                    .text_sm()
                    .text_color(p.text_dim)
                    .child(format!("{} {}", t!("team.noAgents"), t!("team.noAgentsHint"))),
            )
        })
        .children(member_rows)
        .when(!candidates.is_empty(), |c| {
            c.child(heading(t!("team.add").into_owned(), true))
                .when_some(query, |c, q| {
                    c.child(
                        div()
                            .flex()
                            .flex_none()
                            .items_center()
                            .gap(px(space::X2))
                            .mx(px(space::X1))
                            .mb(px(space::X1))
                            .h(px(tokens::CONTROL_H_SM))
                            .px(px(space::X2_5))
                            .rounded(px(tokens::RADIUS_CONTROL_SM))
                            .bg(p.bg_field)
                            .text_sm()
                            .child(icon(IconName::Search, icon::SM).text_color(p.text_muted))
                            .child(div().flex_1().child(Input::new(&q).appearance(false))),
                    )
                })
                .when(add_rows.is_empty(), |c| {
                    c.child(
                        div()
                            .px(px(space::X2))
                            .py(px(space::X1_5))
                            .text_sm()
                            .text_color(p.text_muted)
                            .child(t!("agents.noMatch").into_owned()),
                    )
                })
                .children(add_rows)
        })
        .when(!team_rows.is_empty(), |c| {
            c.child(heading(t!("teams.addTeam").into_owned(), true))
                .children(team_rows)
                .when(spilled > 0, |c| {
                    c.child(
                        div()
                            .px(px(space::X2))
                            .py(px(space::X1))
                            .text_sm()
                            .text_color(p.warning)
                            .child(tn("teams.overflow", spilled as i64)),
                    )
                })
        })
        .when(many, |c| {
            c.child(
                div()
                    .px(px(space::X2))
                    .pt(px(space::X2))
                    .border_t_1()
                    .border_color(p.border)
                    .text_sm()
                    .text_color(p.text_dim)
                    .child(t!("team.mentionHint").into_owned()),
            )
        });
    motion::enter(
        panel,
        SharedString::from(format!("{key}-enter")),
        motion::MENU_IN_MS,
        -4.,
    )
    .into_any_element()
}

/// A row that adds someone: its mark, its name (and a hint under it), a + at the end.
#[allow(clippy::too_many_arguments)]
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

/// The header's pill: the members' faces overlapping, or "+ Add an agent".
#[derive(IntoElement)]
struct Trigger {
    id: ElementId,
    faces: Vec<(String, usize)>,
    names: String,
    lead: FaceState,
    open: bool,
}

impl Selectable for Trigger {
    fn selected(mut self, selected: bool) -> Self {
        self.open = selected;
        self
    }

    fn is_selected(&self) -> bool {
        self.open
    }
}

impl RenderOnce for Trigger {
    fn render(self, window: &mut Window, cx: &mut App) -> impl IntoElement {
        let p = theme::palette(window);
        let pointer = motion::pointer(&self.id, window, cx);
        let lit = pointer.read(cx).hovered || self.open;
        let bg = motion::color(
            &self.id,
            "bg",
            if lit {
                p.bg_control_hover
            } else {
                motion::fade(p.bg_control_hover, 0.)
            },
            window,
            cx,
        );
        let name = if self.faces.is_empty() {
            t!("team.add").into_owned()
        } else {
            t!("chat.members", names = self.names).into_owned()
        };
        let empty = self.faces.is_empty();
        let key = self.id.to_string();
        let row = div()
            .id(self.id.clone())
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
                r.child(
                    div()
                        .flex()
                        .children(self.faces.iter().enumerate().map(|(i, (id, tone))| {
                            div()
                                .when(i > 0, |d| d.ml(px(-6.)))
                                .rounded_full()
                                .border_2()
                                .border_color(p.bg_canvas)
                                .child(
                                    AgentFace::new(SharedString::from(format!("{key}-{id}")), *tone)
                                        .size(20.)
                                        .state(if i == 0 { self.lead } else { FaceState::Idle }),
                                )
                        })),
                )
            });
        motion::track(row, &pointer)
    }
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
