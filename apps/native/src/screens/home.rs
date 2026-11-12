// Home (spec 018/019, apps/web/src/features/home.tsx, prototype Inicio): start something (the project and who answers
// above the box, the model in it; the chat is created on send, then the screen moves to it), what needs you (the
// first two, decided in place), who is working now and what the routines brought today. Prototype layout: the box on
// top, then Needs you and Working now beside Today (one column when narrow).
use std::{collections::HashMap, rc::Rc};

use gpui_kit::{assets::IconName, base::input::TextareaState, prelude::FluentBuilder, *};
use rust_i18n::t;

use crate::ui::button::{Button, Size, Variant};
use crate::ui::icon::{self, icon};
use crate::ui::space;
use serde_json::json;

use crate::{
    format,
    i18n::tn,
    labels,
    net::types::{Agent, Chat, ChatStatusState, RoutinesTodaySuccess, Today},
    route::Route,
    runtime,
    screens::{
        approval,
        composer::{Composer, Draft},
        model_picker::{ModelChoice, ModelPicker},
    },
    state::{
        crew::{self, CHAT_MEMBERS_MAX},
        store::{StatusChanged, Store},
    },
    theme::{
        self,
        tokens::{self, Palette},
    },
    ui::{
        face::{self, AgentFace, FaceState, WorkingRing},
        layout,
        nav::NavRow,
        select::{Mark, OnPick, Select, SelectOption},
    },
};

pub enum HomeEvent {
    Navigate(Route),
}

impl EventEmitter<HomeEvent> for Home {}

pub struct Home {
    store: Entity<Store>,
    project_id: Option<String>,
    /// Who answers when the project has no crew (picked here); else the agent used last.
    chosen: Option<String>,
    /// A model of the person's own; else the lead's.
    picked: Option<ModelChoice>,
    /// The chat a draft created when sending failed after it: the next try reuses it.
    draft_chat: Option<String>,
    composer: Entity<Composer>,
    /// The model the new chat runs on (in the composer's tools).
    model: Entity<ModelPicker>,
    today: Option<Today>,
    /// An answer box per open question shown here.
    answers: HashMap<String, Entity<TextareaState>>,
    _subscriptions: Vec<Subscription>,
}

impl Home {
    pub fn new(store: Entity<Store>, window: &mut Window, cx: &mut Context<Self>) -> Self {
        let view = cx.entity().downgrade();
        let composer = cx.new(|cx| {
            let on_submit: crate::screens::composer::OnSubmit = Rc::new(move |draft, window, cx| {
                let _ = view.update(cx, |this, cx| this.submit(draft, window, cx));
            });
            Composer::new(t!("home.placeholder").into_owned(), true, on_submit, window, cx)
        });
        let subscriptions = vec![
            cx.observe(&store, |_, _, cx| cx.notify()),
            // Who is working comes and goes with statuses; a run that finishes may bring something for Today.
            cx.subscribe(&store, |this, _, _: &StatusChanged, cx| this.refresh(cx)),
        ];
        let view = cx.entity().downgrade();
        let on_change: crate::screens::model_picker::OnChange = Rc::new(move |choice, _, cx| {
            let _ = view.update(cx, |this, cx| {
                this.picked = Some(choice);
                cx.notify();
            });
        });
        let model = cx.new(|cx| ModelPicker::new(store.clone(), false, on_change, window, cx));
        let tools = model.clone();
        composer.update(cx, |c, _| {
            c.set_tools(Rc::new(move |_, _| tools.clone().into_any_element()))
        });
        // # and @ call the agents and teams of the chosen project (all of them join the new chat when named).
        let (home, sources_store) = (cx.entity().downgrade(), store.clone());
        let sources: crate::screens::composer::Sources = Rc::new(move |trigger, cx| {
            use crate::screens::composer::Trigger;
            let project = home.upgrade().and_then(|h| h.read(cx).project_id.clone());
            match trigger {
                Trigger::Lead | Trigger::Mention => {
                    crate::screens::mentions::people(sources_store.read(cx), project.as_deref(), None)
                }
                _ => Vec::new(),
            }
        });
        composer.update(cx, |c, _| c.set_sources(sources));
        composer.update(cx, |c, cx| c.focus(window, cx));
        let mut home = Self {
            store,
            project_id: None,
            chosen: None,
            picked: None,
            draft_chat: None,
            composer,
            model,
            today: None,
            answers: HashMap::new(),
            _subscriptions: subscriptions,
        };
        home.refresh(cx);
        home
    }

    /// The route's project: picking another one forgets who was chosen and the model.
    pub fn set_project(&mut self, project_id: Option<String>, cx: &mut Context<Self>) {
        if self.project_id == project_id {
            return;
        }
        self.project_id = project_id;
        self.chosen = None;
        self.picked = None;
        self.draft_chat = None;
        cx.notify();
    }

    /// Re-reads Today (on arrival and as runs finish).
    pub fn refresh(&mut self, cx: &mut Context<Self>) {
        let http = self.store.read(cx).http.clone();
        cx.spawn(async move |this, cx| {
            match runtime::spawn(async move { http.get::<RoutinesTodaySuccess>("/api/today").await }).await {
                Ok(Ok(today)) => {
                    let _ = this.update(cx, |this, cx| {
                        this.today = Some(today.0);
                        cx.notify();
                    });
                }
                Ok(Err(e)) => eprintln!("today: {e}"),
                Err(e) => eprintln!("today: {e}"),
            }
        })
        .detach();
    }

    /// The agents that can be called here.
    fn callable<'a>(&self, store: &'a Store) -> Vec<&'a Agent> {
        crew::callable(&store.agents, self.project_id.as_deref())
    }

    /// The project's crew: its agents and its teams' members.
    fn crew<'a>(&self, store: &'a Store) -> Vec<&'a Agent> {
        let Some(project) = self
            .project_id
            .as_deref()
            .and_then(|id| store.projects.iter().find(|p| p.id == id))
        else {
            return Vec::new();
        };
        let callable = self.callable(store);
        let callable_ids: Vec<&str> = callable.iter().map(|a| a.id.as_str()).collect();
        let teams: Vec<(&str, &[String])> = crew::teams_in(&store.teams, self.project_id.as_deref())
            .into_iter()
            .map(|t| (t.id.as_str(), t.agent_ids.as_slice()))
            .collect();
        crew::project_crew(&project.agent_ids, &project.team_ids, &teams, &callable_ids)
            .iter()
            .filter_map(|id| store.agent(id))
            .collect()
    }

    /// Who answers outside a crew: the one picked here, else the one used last.
    fn single<'a>(&self, store: &'a Store) -> Option<&'a Agent> {
        let callable = self.callable(store);
        if let Some(chosen) = self
            .chosen
            .as_deref()
            .and_then(|id| callable.iter().find(|a| a.id == id))
        {
            return Some(chosen);
        }
        let ids: Vec<&str> = callable.iter().map(|a| a.id.as_str()).collect();
        let chats: Vec<&Chat> = store.chats.chats.iter().collect();
        crew::last_used(&chats, &ids).and_then(|id| store.agent(&id))
    }

    /// Who the chat starts with: the crew, else the single agent.
    fn members<'a>(&self, store: &'a Store) -> Vec<&'a Agent> {
        let crew = self.crew(store);
        if crew.is_empty() {
            self.single(store).into_iter().collect()
        } else {
            crew
        }
    }

    /// The new chat's model: the person's pick, else the lead's, else Claude Code's Sonnet.
    fn choice(&self, store: &Store) -> ModelChoice {
        self.picked
            .clone()
            .or_else(|| self.members(store).first().map(|a| ModelChoice::of(a)))
            .unwrap_or_default()
    }

    fn submit(&mut self, draft: Draft, window: &mut Window, cx: &mut Context<Self>) {
        let store = self.store.read(cx);
        let members: Vec<String> = self.members(store).iter().map(|a| a.id.clone()).collect();
        let callable = self.callable(store);
        let pairs: Vec<(&str, &str)> = callable.iter().map(|a| (a.id.as_str(), a.name.as_str())).collect();
        let teams: Vec<(&str, &[String])> = crew::teams_in(&store.teams, self.project_id.as_deref())
            .into_iter()
            .map(|t| (t.name.as_str(), t.agent_ids.as_slice()))
            .collect();
        let mut named = crew::to_join(&draft.text, &members, &pairs, &teams);
        named.truncate(CHAT_MEMBERS_MAX.saturating_sub(members.len()));
        let mut choice = self.choice(store);
        // Nobody yet: the first one named leads, and the chat takes its model.
        if members.is_empty()
            && let Some(first) = named.first().and_then(|id| store.agent(id))
        {
            choice.model = first.model.clone();
        }
        let agent_ids: Vec<String> = members.iter().chain(named.iter()).cloned().collect();
        let create = json!({
            "projectId": self.project_id,
            "model": choice.model,
            "accountId": choice.account_id,
            "effort": choice.effort,
            "agentIds": agent_ids,
        });
        let (http, rpc) = (store.http.clone(), store.rpc.clone());
        let existing = self.draft_chat.clone();
        let Draft { text, files } = draft;
        let sent_text = text.clone();
        let task = runtime::spawn(async move {
            let chat_id = match existing {
                Some(id) => {
                    if !named.is_empty() {
                        http.patch::<_, serde_json::Value>(
                            &format!("/api/chats/{id}"),
                            &json!({ "agentIds": agent_ids }),
                        )
                        .await
                        .map_err(|_| (Some(id.clone()), t!("chat.addFailed").into_owned()))?;
                    }
                    id
                }
                None => {
                    http.post::<_, Chat>("/api/chats", &create)
                        .await
                        .map_err(|_| (None, t!("chat.sendFailed").into_owned()))?
                        .id
                }
            };
            crate::net::send::deliver(&http, &rpc, &chat_id, &text, files)
                .await
                .map_err(|msg| (Some(chat_id.clone()), msg))?;
            Ok::<_, (Option<String>, String)>(chat_id)
        });
        cx.spawn_in(window, async move |this, cx| {
            let outcome = task
                .await
                .unwrap_or_else(|_| Err((None, t!("chat.sendFailed").into_owned())));
            let _ = this.update_in(cx, |this, window, cx| match outcome {
                Ok(chat_id) => {
                    this.draft_chat = None;
                    this.store.update(cx, |s, cx| s.reload_chats(cx));
                    cx.emit(HomeEvent::Navigate(Route::Chat { id: chat_id }));
                }
                Err((chat_id, message)) => {
                    this.draft_chat = chat_id.or(this.draft_chat.take());
                    this.composer
                        .update(cx, |c, cx| c.restore(sent_text, message, window, cx));
                }
            });
        })
        .detach();
    }

    fn go(&self, route: Route, cx: &mut Context<Self>) {
        cx.emit(HomeEvent::Navigate(route));
    }

    fn answer_box(&mut self, id: &str, window: &mut Window, cx: &mut Context<Self>) -> Entity<TextareaState> {
        self.answers
            .entry(id.to_string())
            .or_insert_with(|| {
                cx.new(|cx| {
                    let mut state = TextareaState::new(window, cx).placeholder(t!("question.placeholder").into_owned());
                    state.set_auto_grow(2, 6, cx);
                    state
                })
            })
            .clone()
    }

    // Where the chat lives and who answers: the project select, then the crew's faces or the "who answers" select.
    fn scope_row(&self, p: &Palette, cx: &mut Context<Self>) -> Div {
        let store = self.store.read(cx);
        let projects = std::iter::once(SelectOption {
            id: String::new(),
            label: t!("home.noProject").into_owned().into(),
            mark: Mark::None,
        })
        .chain(store.projects.iter().map(|p| SelectOption {
            id: p.id.clone(),
            label: p.name.clone().into(),
            mark: Mark::None,
        }))
        .collect();
        let view = cx.entity().downgrade();
        let pick: OnPick = Rc::new(move |id, _, cx| {
            let id = (!id.is_empty()).then(|| id.to_string());
            let _ = view.update(cx, |this, cx| this.set_project(id, cx));
        });
        let project = Select::new(
            "project",
            t!("home.project").into_owned(),
            projects,
            self.project_id.clone().unwrap_or_default(),
            pick,
        )
        .prefix(IconName::Folder);
        let crew = self.crew(store);
        let who: AnyElement = match crew.as_slice() {
            [] if self.single(store).is_none() => div().into_any_element(),
            [] => {
                let options = self
                    .callable(store)
                    .iter()
                    .map(|a| SelectOption {
                        id: a.id.clone(),
                        label: a.name.clone().into(),
                        mark: Mark::Face(store.tone(Some(&a.id))),
                    })
                    .collect();
                let view = cx.entity().downgrade();
                let pick: OnPick = Rc::new(move |id, _, cx| {
                    let _ = view.update(cx, |this, cx| {
                        this.chosen = Some(id.to_string());
                        this.picked = None;
                        cx.notify();
                    });
                });
                let single = self.single(store).map(|a| a.id.clone()).unwrap_or_default();
                Select::new("who-answers", t!("home.whoAnswers").into_owned(), options, single, pick).into_any_element()
            }
            crew => {
                let one = crew.len() == 1;
                let tone = store.tone(Some(&crew[0].id));
                let hue = face::hue(p, tone);
                let label = if one {
                    t!("home.answers", name = crew[0].name).into_owned()
                } else {
                    tn("home.crew", crew.len() as i64)
                };
                div()
                    .flex()
                    .items_center()
                    .gap(px(space::X1_5))
                    .h(px(tokens::CONTROL_H_SM))
                    .px(px(space::X1))
                    .pr(px(space::X2_5))
                    .rounded_full()
                    .border_1()
                    .text_sm()
                    .map(|d| {
                        if one {
                            d.bg(face::mix(hue, 0.12, p.bg_canvas))
                                .border_color(face::mix(hue, 0.35, p.bg_canvas))
                        } else {
                            d.bg(p.bg_control).border_color(p.bg_control)
                        }
                    })
                    .child(div().flex().children(crew.iter().take(3).enumerate().map(|(i, a)| {
                        div().when(i > 0, |d| d.ml(px(-6.))).child(
                            AgentFace::new(SharedString::from(format!("crew-{}", a.id)), store.tone(Some(&a.id)))
                                .size(20.),
                        )
                    })))
                    .child(div().max_w(px(192.)).truncate().child(label))
                    .into_any_element()
            }
        };
        div().flex().items_center().gap(px(space::X1)).child(project).child(who)
    }

    // The first two approvals and questions, decided here; all of them in Needs you.
    fn needs_you(&mut self, p: &Palette, window: &mut Window, cx: &mut Context<Self>) -> Div {
        let approvals = self.store.read(cx).needs_you();
        if approvals.is_empty() {
            return section(
                p,
                t!("home.needsYou").into_owned(),
                None,
                quiet(p, "needs-quiet", "home.allClear", "home.allClearHint"),
            );
        }
        let see_all = (approvals.len() > 2).then(|| {
            Button::new("see-all", t!("home.seeAll").into_owned())
                .variant(Variant::Ghost)
                .size(Size::Sm)
                .on_click(cx.listener(|this, _, _, cx| this.go(Route::Inbox, cx)))
                .into_any_element()
        });
        let mut cards = Vec::new();
        for a in approvals.iter().take(2) {
            let answer = approval::is_question(a).then(|| self.answer_box(&a.id, window, cx));
            let store = self.store.clone();
            let decide: approval::Decide = Rc::new(move |id, outcome, reason, _, cx| {
                store.update(cx, |s, cx| s.decide(id, outcome, reason, cx));
            });
            let view = cx.entity().downgrade();
            let open: approval::OpenChat = Rc::new(move |chat_id, _, cx| {
                let _ = view.update(cx, |this, cx| this.go(Route::Chat { id: chat_id }, cx));
            });
            cards.push(approval::card(
                a,
                self.store.read(cx),
                answer.as_ref(),
                decide,
                open,
                window,
            ));
        }
        section(
            p,
            format!("{} · {}", t!("home.needsYou"), approvals.len()),
            see_all,
            div().flex().flex_col().gap(px(space::X3)).children(cards),
        )
    }

    // Chats an agent works in now, each with its face and what it does.
    fn working_now(&self, p: &Palette, cx: &mut Context<Self>) -> Div {
        let store = self.store.read(cx);
        let mut live: Vec<_> = store
            .chats
            .statuses
            .values()
            .filter(|s| matches!(s.state, ChatStatusState::Running))
            .filter_map(|s| store.chat(&s.chat_id).map(|c| (s, c)))
            .collect();
        live.sort_by(|a, b| {
            b.1.last_at
                .unwrap_or(b.1.created_at)
                .total_cmp(&a.1.last_at.unwrap_or(a.1.created_at))
        });
        if live.is_empty() {
            return section(
                p,
                t!("home.workingNow").into_owned(),
                None,
                quiet(p, "working-quiet", "home.nobodyWorking", "home.nobodyWorkingHint"),
            );
        }
        let rows: Vec<AnyElement> = live
            .into_iter()
            .map(|(status, chat)| {
                let lead = chat.agent_ids.first().and_then(|id| store.agent(id));
                let mark: AnyElement = match lead {
                    Some(a) => AgentFace::new(
                        SharedString::from(format!("working-{}", chat.id)),
                        store.tone(Some(&a.id)),
                    )
                    .size(28.)
                    .state(FaceState::Working)
                    .into_any_element(),
                    None => WorkingRing::new(SharedString::from(format!("ring-{}", chat.id)))
                        .size(20.)
                        .into_any_element(),
                };
                let id = chat.id.clone();
                NavRow::new(
                    SharedString::from(format!("working-row-{}", chat.id)),
                    labels::chat_title(chat),
                )
                .leading(mark)
                .detail(labels::status_label(status, store), None)
                .emphasis(true)
                .trailing(chevron(p))
                .on_click(cx.listener(move |this, _, _, cx| this.go(Route::Chat { id: id.clone() }, cx)))
                .into_any_element()
            })
            .collect();
        section(p, t!("home.workingNow").into_owned(), None, rows_card(p).children(rows))
    }

    // What the routines brought since the day started, the quiet runs counted, and the next run.
    fn today_card(&self, p: &Palette, cx: &mut Context<Self>) -> Option<Div> {
        let today = self.today.as_ref()?;
        let store = self.store.read(cx);
        let l = format::lang();
        let now = format::now_ms();
        let next = store
            .routines
            .iter()
            .filter(|r| r.enabled && r.next_run_at.is_some())
            .min_by(|a, b| a.next_run_at.unwrap_or(0.).total_cmp(&b.next_run_at.unwrap_or(0.)));
        let mut rows: Vec<AnyElement> = Vec::new();
        for run in &today.found {
            let routine = store.routines.iter().find(|r| r.id == run.routine_id);
            let tone = routine.map(|r| store.tone(Some(&r.agent_id)));
            let title = if run.summary.is_empty() {
                t!("routines.runs.outcome.something").into_owned()
            } else {
                run.summary.clone()
            };
            let hint = routine
                .map(|r| r.name.clone())
                .into_iter()
                .chain(std::iter::once(format::time(run.created_at, now, l)))
                .collect::<Vec<_>>()
                .join(" · ");
            // ponytail: a versioned run opens its own page with the routines screen (T054); its chat until then.
            let chat_id = routine.map(|r| r.chat_id.clone());
            rows.push(
                NavRow::new(SharedString::from(format!("today-{}", run.id)), title)
                    .when_some(tone, |r, tone| {
                        r.leading(AgentFace::new(SharedString::from(format!("today-face-{}", run.id)), tone).size(20.))
                    })
                    .detail(hint, None)
                    .when_some(chat_id, |r, id| {
                        r.on_click(cx.listener(move |this, _, _, cx| this.go(Route::Chat { id: id.clone() }, cx)))
                    })
                    .into_any_element(),
            );
        }
        // ponytail: the quiet runs and the next run open the routines screen once it exists (T054).
        if today.quiet > 0. {
            rows.push(NavRow::new("today-quiet", tn("today.quiet", today.quiet as i64)).into_any_element());
        }
        if let Some(next) = next {
            let label = t!(
                "home.nextRun",
                name = next.name,
                time = format::time(next.next_run_at.unwrap_or(0.), now, l)
            )
            .into_owned();
            rows.push(
                NavRow::new("today-next", label)
                    .icon(IconName::AlarmClock)
                    .into_any_element(),
            );
        }
        let calm = today.found.is_empty() && today.quiet == 0.;
        Some(
            layout::card(p)
                .flex()
                .flex_col()
                .gap(px(space::X1))
                .child(
                    div()
                        .flex()
                        .items_baseline()
                        .justify_between()
                        .px(px(space::X2_5))
                        .pt(px(space::X1_5))
                        .pb(px(space::X1_5))
                        .child(
                            div()
                                .font_weight(FontWeight::SEMIBOLD)
                                .child(t!("home.today").into_owned()),
                        )
                        .child(
                            div()
                                .text_sm()
                                .text_color(p.text_dim)
                                .child(t!("home.todaySince", time = format::time(today.from, now, l)).into_owned()),
                        ),
                )
                .when(calm, |c| {
                    c.child(quiet_body(
                        p,
                        "today-quiet-face",
                        "home.todayQuiet",
                        "home.todayQuietHint",
                    ))
                })
                .children(rows),
        )
    }
}

impl Render for Home {
    fn render(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        crate::hot::call(|| self.view(window, cx))
    }
}

impl Home {
    fn view(&mut self, window: &mut Window, cx: &mut Context<Self>) -> Stateful<Div> {
        let p = theme::palette(window);
        let now = format::now_ms();
        let part = match format::hour(now) {
            h if h < 12 => "home.morning",
            h if h < 18 => "home.afternoon",
            _ => "home.evening",
        };
        let greeting = format!("{} · {}", t!(part), format::weekday_date(now, format::lang()));
        // The model picker shows the chat's model to be: the person's pick, else the lead's.
        let choice = self.choice(self.store.read(cx));
        self.model.update(cx, |m, cx| m.set_value(choice, cx));
        let scope = self.scope_row(p, cx);
        let needs_you = self.needs_you(p, window, cx);
        let working = self.working_now(p, cx);
        let today = self.today_card(p, cx);
        // The sidebar (272) + the two columns (960) + gutters.
        let wide = window.viewport_size().width > px(1300.);
        div()
            .id("home")
            .relative()
            .size_full()
            .overflow_y_scroll()
            .child(orbit(p))
            .child(
                div()
                    .relative()
                    .flex()
                    .flex_col()
                    .items_center()
                    .px(px(space::X7))
                    .pt(px(space::X12))
                    .pb(px(space::X10))
                    .child(
                        div()
                            .w_full()
                            .max_w(px(680.))
                            .flex()
                            .flex_col()
                            .gap(px(space::X4))
                            .child(
                                div()
                                    .flex()
                                    .flex_col()
                                    .items_center()
                                    .gap(px(space::X1))
                                    .mb(px(space::X2_5))
                                    .child(div().text_sm().text_color(p.text_muted).child(greeting))
                                    .child(
                                        div()
                                            .text_size(px(28.))
                                            .line_height(px(34.))
                                            .font_weight(FontWeight::SEMIBOLD)
                                            .child(t!("home.title").into_owned()),
                                    ),
                            )
                            .child(
                                div()
                                    .flex()
                                    .flex_col()
                                    .gap(px(space::X1_5))
                                    .child(scope)
                                    .child(self.composer.clone()),
                            ),
                    )
                    .child(
                        // Two columns when the window has room for them (prototype), else one.
                        div()
                            .w_full()
                            .max_w(px(if wide { 960. } else { 680. }))
                            .mt(px(space::X10))
                            .flex()
                            .when(!wide, |c| c.flex_col())
                            .items_start()
                            .gap(px(space::X6))
                            .child(
                                div()
                                    .flex_1()
                                    .min_w_0()
                                    .w_full()
                                    .flex()
                                    .flex_col()
                                    .gap(px(space::X6))
                                    .child(needs_you)
                                    .child(working),
                            )
                            .when_some(today, |c, today| {
                                c.child(
                                    div()
                                        .flex_none()
                                        .map(|d| if wide { d.w(px(340.)) } else { d.w_full() })
                                        .child(today),
                                )
                            }),
                    ),
            )
    }
}

/// A titled block: the title (and an action on the right) above its body.
fn section(p: &Palette, title: String, action: Option<AnyElement>, body: impl IntoElement) -> Div {
    div()
        .flex()
        .flex_col()
        .gap(px(space::X2_5))
        .child(
            div()
                .flex()
                .items_center()
                .justify_between()
                .h(px(24.))
                .child(div().font_weight(FontWeight::SEMIBOLD).text_color(p.text).child(title))
                .children(action),
        )
        .child(body)
}

/// A card that holds rows (Working now).
fn rows_card(p: &Palette) -> Div {
    layout::card(p).flex().flex_col().gap(px(space::X0_5))
}

/// A section with nothing in it says so kindly: a resting face, the line and its hint.
fn quiet(p: &Palette, id: &'static str, title: &str, hint: &str) -> Div {
    layout::card(p).child(quiet_body(p, id, title, hint))
}

fn quiet_body(p: &Palette, id: &'static str, title: &str, hint: &str) -> Div {
    div()
        .flex()
        .items_center()
        .gap(px(space::X4))
        .px(px(space::X2_5))
        .py(px(space::X2))
        .child(AgentFace::new(id, 0).size(28.))
        .child(
            div()
                .flex()
                .flex_col()
                .min_w_0()
                .child(div().font_weight(FontWeight::MEDIUM).child(t!(title).into_owned()))
                .child(div().text_sm().text_color(p.text_muted).child(t!(hint).into_owned())),
        )
}

fn chevron(p: &Palette) -> impl IntoElement {
    icon(IconName::ChevronRight, icon::MD).text_color(p.text_muted)
}

/// A quiet echo of the mark behind the top: two hairline rings centred under the title (decoration only).
fn orbit(p: &Palette) -> impl IntoElement {
    let ring = |size: f32, alpha: f32| {
        div()
            .absolute()
            .left(relative(0.5))
            .top(px(130. - size / 2.))
            .ml(px(-size / 2.))
            .size(px(size))
            .rounded_full()
            .border_1()
            .border_color(Rgba { a: alpha, ..p.text })
    };
    div()
        .absolute()
        .top_0()
        .left_0()
        .right_0()
        .h(px(420.))
        .overflow_hidden()
        .child(ring(520., 0.045))
        .child(ring(860., 0.03))
}
