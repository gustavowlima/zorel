// The sidebar's foot (parity/sidebar.md › Foot): Usage (a popover with every signed-in account's limit windows, the
// account most at risk marked on the icon), Pause / Resume all agents, Settings. Folded, the same in a column.
// ponytail: Settings and Usage's "See all" open their screens once those exist; until then Settings is disabled and
// "See all" isn't offered.
use gpui_kit::{
    assets::IconName,
    component::{
        Disableable as _, Sizable as _,
        button::{Button, ButtonVariants as _},
        popover::Popover,
    },
    prelude::FluentBuilder,
    *,
};
use rust_i18n::t;

use crate::{
    format,
    labels::{Tone, pace_of, tone_of, window_label, window_minutes},
    net::types::{ProviderAccount, ProviderAccountKind},
    screens::sidebar::Sidebar,
    state::store::Store,
    theme::{self, tokens::Palette},
};

/// One account's windows with their pace, and its riskiest limited window.
struct Row<'a> {
    account: &'a ProviderAccount,
    windows: Vec<(String, f64, Option<f64>, crate::labels::Pace)>,
    worst: Option<f64>,
    worst_tone: Option<Tone>,
}

fn rows(store: &Store) -> Vec<Row<'_>> {
    let now = format::now_ms();
    let mut rows: Vec<Row> = store
        .accounts
        .iter()
        .filter(|a| a.logged_in)
        .map(|account| {
            let windows: Vec<_> = account
                .usage
                .iter()
                .flat_map(|u| u.windows.iter())
                .map(|w| {
                    (
                        w.id.clone(),
                        w.used_percent,
                        w.resets_at,
                        pace_of(&w.id, w.used_percent, w.resets_at, now),
                    )
                })
                .collect();
            let worst = windows
                .iter()
                .filter(|w| window_minutes(&w.0).is_some())
                .max_by(|a, b| a.3.risk.total_cmp(&b.3.risk));
            let (worst_risk, worst_tone) = (worst.map(|w| w.3.risk), worst.map(|w| tone_of(&w.3)));
            Row {
                account,
                windows,
                worst: worst_risk,
                worst_tone,
            }
        })
        .collect();
    rows.sort_by(|a, b| b.worst.unwrap_or(-1.).total_cmp(&a.worst.unwrap_or(-1.)));
    rows
}

fn tone_color(tone: Tone, p: &Palette) -> Rgba {
    match tone {
        Tone::Ok => p.text,
        Tone::Warning => p.warning,
        Tone::Critical => p.danger,
    }
}

impl Sidebar {
    pub(super) fn foot(&self, folded: bool, window: &Window, cx: &Context<Self>) -> AnyElement {
        let p = theme::palette(window);
        let store = self.store.read(cx);
        let rows = rows(store);
        let risk = rows.first().and_then(|r| r.worst_tone).filter(|t| *t != Tone::Ok);
        let paused = store.paused;

        let list: Vec<AnyElement> = if rows.is_empty() {
            vec![
                div()
                    .py(px(8.))
                    .text_sm()
                    .text_color(p.text_muted)
                    .child(t!("nav.usageNone").into_owned())
                    .into_any_element(),
            ]
        } else {
            rows.iter()
                .map(|r| {
                    let account = r.account;
                    let windows: Vec<AnyElement> = if r.windows.is_empty() {
                        let key = if matches!(account.kind, ProviderAccountKind::ApiKey) {
                            "nav.usageKey"
                        } else {
                            "nav.usageNoLimits"
                        };
                        vec![
                            div()
                                .text_xs()
                                .text_color(p.text_muted)
                                .child(t!(key).into_owned())
                                .into_any_element(),
                        ]
                    } else {
                        r.windows
                            .iter()
                            .map(|(id, _, resets, pace)| {
                                let resets = resets
                                    .map(|at| {
                                        format!(
                                            " · {}",
                                            t!(
                                                "usage.resets",
                                                time = format::time(at, format::now_ms(), format::lang())
                                            )
                                        )
                                    })
                                    .unwrap_or_default();
                                div()
                                    .flex()
                                    .justify_between()
                                    .gap(px(12.))
                                    .text_xs()
                                    .child(div().truncate().text_color(p.text_secondary).child(window_label(id)))
                                    .child(
                                        div()
                                            .flex_none()
                                            .flex()
                                            .child(
                                                div()
                                                    .text_color(tone_color(tone_of(pace), p))
                                                    .child(format::percent(pace.used)),
                                            )
                                            .child(div().text_color(p.text_muted).child(resets)),
                                    )
                                    .into_any_element()
                            })
                            .collect()
                    };
                    div()
                        .flex()
                        .flex_col()
                        .gap(px(8.))
                        .py(px(12.))
                        .border_t_1()
                        .border_color(p.border)
                        .child(
                            div()
                                .text_sm()
                                .font_weight(FontWeight::MEDIUM)
                                .truncate()
                                .child(account.label.clone()),
                        )
                        .children(windows)
                        .into_any_element()
                })
                .collect()
        };
        let store_entity = self.store.clone();
        let usage = Popover::new("usage")
            .anchor(if folded { Anchor::BottomLeft } else { Anchor::BottomLeft })
            .trigger(
                Button::new("usage-trigger")
                    .ghost()
                    .small()
                    .icon(IconName::ChartColumn)
                    .tooltip(t!("nav.usage").into_owned()),
            )
            .w(px(320.))
            .child(
                div()
                    .flex()
                    .items_center()
                    .justify_between()
                    .child(
                        div()
                            .text_sm()
                            .font_weight(FontWeight::MEDIUM)
                            .child(t!("nav.usage").into_owned()),
                    )
                    .child(
                        Button::new("usage-refresh")
                            .ghost()
                            .xsmall()
                            .icon(IconName::RefreshCw)
                            .tooltip(t!("usage.refresh").into_owned())
                            .disabled(rows.is_empty())
                            .on_click(move |_, _, cx| store_entity.update(cx, |s, cx| s.refresh_limits(cx))),
                    ),
            )
            .child(div().flex().flex_col().children(list));
        let usage = div().relative().child(usage).when_some(risk, |c, tone| {
            c.child(
                div()
                    .absolute()
                    .top(px(5.))
                    .right(px(5.))
                    .size(px(8.))
                    .rounded_full()
                    .bg(tone_color(tone, p))
                    .border_2()
                    .border_color(p.bg_sidebar),
            )
        });
        let store_entity = self.store.clone();
        let pause = Button::new("pause")
            .ghost()
            .small()
            .icon(if paused { IconName::Play } else { IconName::Pause })
            .tooltip(if paused {
                t!("pause.resume").into_owned()
            } else {
                t!("pause.all").into_owned()
            })
            .on_click(move |_, _, cx| store_entity.update(cx, |s, cx| s.set_paused(!paused, cx)));
        let settings = Button::new("settings")
            .ghost()
            .small()
            .icon(IconName::Settings)
            .tooltip(t!("nav.settings").into_owned())
            .disabled(true);
        div()
            .flex()
            .flex_none()
            .items_center()
            .gap(px(4.))
            .when(folded, |f| f.flex_col())
            .child(usage)
            .when(!folded, |f| f.child(div().flex_1()))
            .child(pause)
            .child(settings)
            .into_any_element()
    }
}
