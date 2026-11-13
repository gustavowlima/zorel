// Settings (apps/web/src/features/settings.tsx): the sections down the left, one at a time on the right, in a centred
// column. Each section is its own module; General is here.
// General: Appearance (the theme held on light or dark or following the system, the language, live steps open or
// folded; each applied at once, kept in this computer's preferences), Memory (what a new fact becomes), Agents (how
// many work at once, and in one chat) and About (the version). The engine's preferences save as they change.
// ponytail: accent colour, notifications, Your day, team servers, startup and update checks come with their own
// tasks (T044-T048); Skills, Channels, Storage, Audit and Team sections follow Providers, Connectors and Processes.
mod connectors;
mod processes;
mod providers;
mod servers;
mod skills;

use std::rc::Rc;

use gpui_kit::{assets::IconName, prelude::FluentBuilder, *};
use rust_i18n::t;
use serde_json::{Value, json};

use crate::{
    format,
    net::types::Preferences,
    runtime,
    state::{prefs::Prefs, store::Store},
    theme,
    ui::{
        icon::{self, icon},
        segmented::Segmented,
        select::{self, Select, SelectOption},
        space,
        switch::switch,
    },
};

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Section {
    General,
    Providers,
    Connectors,
    Servers,
    Skills,
    Appearance,
    Processes,
}

impl Section {
    pub const ALL: [Section; 7] = [
        Section::General,
        Section::Providers,
        Section::Connectors,
        Section::Servers,
        Section::Skills,
        Section::Appearance,
        Section::Processes,
    ];

    /// Its i18n key under settings.* (and settings.hint.*).
    fn key(self) -> &'static str {
        match self {
            Section::General => "general",
            Section::Providers => "accounts",
            Section::Connectors => "mcp",
            Section::Servers => "servers",
            Section::Skills => "skills",
            Section::Appearance => "appearance",
            Section::Processes => "processes",
        }
    }

    fn icon(self) -> IconName {
        match self {
            Section::General => IconName::Settings,
            Section::Providers => IconName::Sparkles,
            Section::Connectors => IconName::Plug,
            Section::Servers => IconName::SquareTerminal,
            Section::Skills => IconName::Brain,
            Section::Appearance => IconName::Sun,
            Section::Processes => IconName::Gauge,
        }
    }
}

const MAX_RUNNING: [u32; 8] = [0, 1, 2, 3, 4, 6, 8, 12];
const PER_CHAT: [u32; 7] = [0, 1, 2, 3, 4, 6, 8];

pub struct Settings {
    store: Entity<Store>,
    section: Section,
    prefs: Option<Preferences>,
    providers: providers::Providers,
    connectors: servers::Connectors,
    processes: processes::Processes,
    skills: skills::Skills,
}

impl Settings {
    pub fn new(store: Entity<Store>, section: Section, cx: &mut Context<Self>) -> Self {
        cx.observe(&store, |_, _, cx| cx.notify()).detach();
        let mut this = Self {
            store,
            section,
            prefs: None,
            providers: Default::default(),
            connectors: Default::default(),
            processes: Default::default(),
            skills: Default::default(),
        };
        this.load_connectors(cx);
        this.load_prefs(cx);
        this
    }

    pub fn open(&mut self, section: Section, cx: &mut Context<Self>) {
        self.section = section;
        cx.notify();
    }

    fn load_prefs(&mut self, cx: &mut Context<Self>) {
        let http = self.store.read(cx).http.clone();
        cx.spawn(async move |this, cx| {
            if let Ok(Ok(p)) = runtime::spawn(async move { http.get::<Preferences>("/api/preferences").await }).await {
                let _ = this.update(cx, |this, cx| {
                    this.prefs = Some(p);
                    cx.notify();
                });
            }
        })
        .detach();
    }

    /// Saves one engine preference (PUT /api/preferences/<path>); the answer is the preferences now.
    fn put_pref(&mut self, path: &'static str, body: Value, cx: &mut Context<Self>) {
        let http = self.store.read(cx).http.clone();
        cx.spawn(async move |this, cx| {
            let url = format!("/api/preferences/{path}");
            match runtime::spawn(async move { http.put::<_, Preferences>(&url, &body).await }).await {
                Ok(Ok(p)) => {
                    let _ = this.update(cx, |this, cx| {
                        this.prefs = Some(p);
                        cx.notify();
                    });
                }
                Ok(Err(e)) => eprintln!("preferences: {e}"),
                Err(_) => {}
            }
        })
        .detach();
    }

    fn appearance(&mut self, window: &mut Window, cx: &mut Context<Self>) -> AnyElement {
        let p = theme::palette(window);
        let local = Prefs::get(cx).clone();
        let theme_at = match local.theme.as_str() {
            "dark" => 1,
            "light" => 2,
            _ => 0,
        };
        let themes = ["system", "dark", "light"];
        let theme_pick = Segmented::new(
            "settings-theme",
            t!("appearance.theme").into_owned(),
            themes
                .iter()
                .map(|k| SharedString::from(t!(format!("appearance.{k}")).into_owned()))
                .collect(),
            theme_at,
            Rc::new(move |i, window, cx| {
                Prefs::update(cx, |p| p.theme = themes[i].to_string());
                theme::set_choice(themes[i], Some(window), cx);
            }),
        );
        let language = Select::new(
            "settings-language",
            t!("appearance.language").into_owned(),
            vec![
                SelectOption {
                    id: "system".into(),
                    label: t!("appearance.languageSystem").into_owned().into(),
                    mark: select::Mark::None,
                },
                // Each language in its own words, so it can be found whatever the current one is.
                SelectOption {
                    id: "en".into(),
                    label: "English".into(),
                    mark: select::Mark::None,
                },
                SelectOption {
                    id: "pt-BR".into(),
                    label: "Português (Brasil)".into(),
                    mark: select::Mark::None,
                },
            ],
            if local.language.is_empty() {
                "system".to_string()
            } else {
                local.language.clone()
            },
            Rc::new(|v, _, cx| {
                Prefs::update(cx, |p| p.language = v.to_string());
                crate::i18n::set(v);
                cx.refresh_windows();
            }),
        );
        let steps = switch(
            "settings-live-steps",
            String::new(),
            !local.live_steps_folded,
            Rc::new(|on, window, cx| {
                Prefs::update(cx, |p| p.live_steps_folded = !on);
                window.refresh();
                cx.refresh_windows();
            }),
            window,
            cx,
        );
        group(
            t!("appearance.title").into_owned(),
            vec![
                row(
                    t!("appearance.theme").into_owned(),
                    t!("appearance.themeHint").into_owned(),
                    theme_pick.into_any_element(),
                    p,
                ),
                row(
                    t!("appearance.language").into_owned(),
                    t!("appearance.languageHint").into_owned(),
                    language.into_any_element(),
                    p,
                ),
                row(
                    t!("appearance.liveSteps").into_owned(),
                    t!("appearance.liveStepsHint").into_owned(),
                    steps,
                    p,
                ),
            ],
            p,
        )
        .into_any_element()
    }

    /// Zorel itself: what a new memory becomes, how many agents work at once, the version.
    fn general(&mut self, window: &mut Window, cx: &mut Context<Self>) -> AnyElement {
        let p = theme::palette(window);
        let prefs = self.prefs.clone();
        let approval_now = prefs
            .as_ref()
            .map_or("review".to_string(), |p| p.memory_approval.to_string());
        let view = cx.entity().downgrade();
        let approval = Select::new(
            "settings-memory-approval",
            t!("memory.approval").into_owned(),
            ["review", "undo"]
                .iter()
                .map(|k| SelectOption {
                    id: k.to_string(),
                    label: t!(if *k == "review" {
                        "memory.approvalReview"
                    } else {
                        "memory.approvalUndo"
                    })
                    .into_owned()
                    .into(),
                    mark: select::Mark::None,
                })
                .collect(),
            approval_now,
            Rc::new(move |v, _, cx| {
                let v = v.to_string();
                let _ = view.update(cx, |this, cx| {
                    this.put_pref("memory-approval", json!({ "approval": v }), cx)
                });
            }),
        );
        let count_select =
            |id: &'static str, path: &'static str, name: String, choices: &[u32], now: u32, cx: &mut Context<Self>| {
                let view = cx.entity().downgrade();
                Select::new(
                    id,
                    name,
                    choices
                        .iter()
                        .map(|n| SelectOption {
                            id: n.to_string(),
                            label: if *n == 0 {
                                t!("agentsLimit.noLimit").into_owned().into()
                            } else {
                                n.to_string().into()
                            },
                            mark: select::Mark::None,
                        })
                        .collect(),
                    now.to_string(),
                    Rc::new(move |v, _, cx| {
                        let n: u32 = v.parse().unwrap_or(0);
                        let _ = view.update(cx, |this, cx| this.put_pref(path, json!({ "value": n }), cx));
                    }),
                )
            };
        let at_once = count_select(
            "settings-max-running",
            "max-running",
            t!("agentsLimit.atOnce").into_owned(),
            &MAX_RUNNING,
            prefs.as_ref().map_or(4, |p| p.max_running as u32),
            cx,
        );
        let per_chat = count_select(
            "settings-max-per-chat",
            "max-per-chat",
            t!("agentsLimit.perChat").into_owned(),
            &PER_CHAT,
            prefs.as_ref().map_or(0, |p| p.max_per_chat as u32),
            cx,
        );
        div()
            .flex()
            .flex_col()
            .gap(px(space::X8))
            .child(group(
                t!("settings.modelsTitle").into_owned(),
                vec![row(
                    t!("memory.approval").into_owned(),
                    t!("memory.approvalHint").into_owned(),
                    approval.into_any_element(),
                    p,
                )],
                p,
            ))
            .child(group(
                t!("agentsLimit.title").into_owned(),
                vec![
                    row(
                        t!("agentsLimit.atOnce").into_owned(),
                        t!("agentsLimit.atOnceHint").into_owned(),
                        at_once.into_any_element(),
                        p,
                    ),
                    row(
                        t!("agentsLimit.perChat").into_owned(),
                        t!("agentsLimit.perChatHint").into_owned(),
                        per_chat.into_any_element(),
                        p,
                    ),
                ],
                p,
            ))
            .child(group(
                t!("appearance.about").into_owned(),
                vec![row(
                    t!("appearance.version", version = env!("CARGO_PKG_VERSION")).into_owned(),
                    t!("appearance.versionHint").into_owned(),
                    div().into_any_element(),
                    p,
                )],
                p,
            ))
            .into_any_element()
    }
}

/// A titled group of setting rows, hairlines between them.
pub(crate) fn group(title: String, rows: Vec<AnyElement>, p: &theme::tokens::Palette) -> Div {
    div()
        .flex()
        .flex_col()
        .gap(px(space::X2))
        .child(
            div()
                .text_sm()
                .font_weight(FontWeight::MEDIUM)
                .text_color(p.text_muted)
                .child(title),
        )
        .child(
            div().flex().flex_col().children(
                rows.into_iter()
                    .enumerate()
                    .map(|(i, r)| div().when(i > 0, |d| d.border_t_1().border_color(p.border)).child(r)),
            ),
        )
}

/// One setting: its title and hint on the left, its control on the right.
pub(crate) fn row(title: String, hint: String, control: AnyElement, p: &theme::tokens::Palette) -> AnyElement {
    div()
        .flex()
        .items_center()
        .gap(px(space::X6))
        .py(px(space::X3))
        .child(
            div()
                .flex()
                .flex_col()
                .flex_1()
                .min_w_0()
                .gap(px(space::X0_5))
                .child(div().font_weight(FontWeight::MEDIUM).child(title))
                .when(!hint.is_empty(), |d| {
                    d.child(div().text_sm().text_color(p.text_muted).max_w(px(520.)).child(hint))
                }),
        )
        .child(div().flex_none().child(control))
        .into_any_element()
}

impl Settings {
    /// What each section holds, for the menu: accounts, connectors on, servers added, skills in use.
    fn counts(&self, cx: &App) -> Vec<(Section, usize)> {
        let store = self.store.read(cx);
        let servers = self.connectors.list.as_deref().unwrap_or_default();
        let catalog = servers.iter().filter(|s| connectors::catalog_of(s).is_some()).count();
        vec![
            (Section::Providers, store.accounts.len()),
            (Section::Connectors, catalog),
            (Section::Servers, servers.len() - catalog),
            (
                Section::Skills,
                store
                    .memories
                    .iter()
                    .filter(|m| {
                        matches!(m.kind, crate::net::types::MemoryKind::Skill)
                            && !matches!(m.state, crate::net::types::MemoryState::Forgotten)
                    })
                    .count(),
            ),
        ]
    }
}

impl Render for Settings {
    fn render(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        crate::hot::call(|| self.view(window, cx))
    }
}

impl Settings {
    fn view(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement + use<> {
        let p = theme::palette(window);
        let current = self.section;
        let counts = self.counts(cx);
        let nav: Vec<AnyElement> = Section::ALL
            .iter()
            .map(|&s| {
                let active = s == current;
                div()
                    .id(SharedString::from(format!("settings-nav-{}", s.key())))
                    .flex()
                    .items_center()
                    .gap(px(space::X2_5))
                    .h(px(crate::theme::tokens::CONTROL_H))
                    .px(px(space::X2_5))
                    .rounded(px(crate::theme::tokens::RADIUS_ROW))
                    .text_color(if active { p.text } else { p.text_secondary })
                    .when(active, |d| d.bg(p.bg_control).font_weight(FontWeight::MEDIUM))
                    .hover(|d| d.bg(p.bg_control))
                    .child(icon(s.icon(), icon::MD).text_color(if active { p.text } else { p.text_muted }))
                    .child(div().flex_1().child(t!(format!("settings.{}", s.key())).into_owned()))
                    .children(
                        counts
                            .iter()
                            .find(|(x, _)| *x == s)
                            .filter(|(_, n)| *n > 0)
                            .map(|(_, n)| div().text_sm().text_color(p.text_muted).child(n.to_string())),
                    )
                    .on_click(cx.listener(move |this, _, _, cx| this.open(s, cx)))
                    .into_any_element()
            })
            .collect();
        let body = match current {
            Section::General => self.general(window, cx),
            Section::Providers => self.providers_view(window, cx),
            Section::Connectors => self.connectors_view(window, cx),
            Section::Servers => self.servers_view(window, cx),
            Section::Skills => self.skills_view(window, cx),
            Section::Appearance => self.appearance(window, cx),
            Section::Processes => self.processes_view(window, cx),
        };
        div()
            .flex()
            .size_full()
            .child(
                div()
                    .flex()
                    .flex_col()
                    .flex_none()
                    .w(px(224.))
                    .gap(px(space::X0_5))
                    .p(px(space::X3))
                    .border_r_1()
                    .border_color(p.border)
                    .children(nav),
            )
            .child(
                div().id("settings-body").flex_1().min_w_0().overflow_y_scroll().child(
                    div()
                        .w_full()
                        .max_w(px(760.))
                        .mx_auto()
                        .px(px(space::X8))
                        .py(px(space::X6))
                        .flex()
                        .flex_col()
                        .gap(px(space::X6))
                        .child(
                            div()
                                .text_sm()
                                .text_color(p.text_muted)
                                .child(t!(format!("settings.hint.{}", current.key())).into_owned()),
                        )
                        .child(body),
                ),
            )
    }
}
