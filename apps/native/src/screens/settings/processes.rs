// Settings › Processes (apps/web/src/features/processes.tsx): Zorel's use with a little personality on top (how it
// feels now, memory and CPU live), its last 24 hours as a chart (a reading every 5 minutes, kept by the engine) and
// where it goes by part; then what runs in the background now, read every 5 s while the section shows: servers the
// agents started (Stop), shells (Close), agent sessions (Close), connections (Disconnect), each with its use.
use super::*;

use crate::{
    net::types::{ProcessList, UsageSample},
    ui::{
        button::{Button, Size, Variant},
        chart,
        face::AgentFace,
    },
};

/// How often the 24-hour history is read again while the section shows (the engine adds a reading every 5 minutes).
const HISTORY_EVERY: std::time::Duration = std::time::Duration::from_secs(60);
const DAY_MS: f64 = 24. * 60. * 60. * 1000.;

#[derive(Default)]
pub struct Processes {
    list: Option<ProcessList>,
    polling: Option<Task<()>>,
    history: Vec<UsageSample>,
    history_at: Option<std::time::Instant>,
    /// The chart's reading: memory (0) or CPU (1).
    metric: usize,
}

/// How Zorel feels now, by how much of the computer it takes: its i18n key under processes.usage.mood.
fn mood(cpu: f64, memory: f64, total: f64) -> &'static str {
    let share = memory / total.max(1.);
    if cpu >= 150. || share >= 0.25 {
        "busy"
    } else if cpu >= 25. || share >= 0.08 {
        "working"
    } else {
        "calm"
    }
}

fn mb(bytes: f64) -> String {
    if bytes >= 1024. * 1024. * 1024. {
        format!("{:.1} GB", bytes / (1024. * 1024. * 1024.))
    } else {
        format!("{:.0} MB", bytes / (1024. * 1024.))
    }
}

impl Settings {
    fn load_processes(&mut self, cx: &mut Context<Self>) {
        let http = self.store.read(cx).http.clone();
        cx.spawn(async move |this, cx| {
            if let Ok(Ok(l)) = runtime::spawn(async move { http.get::<ProcessList>("/api/processes").await }).await {
                let _ = this.update(cx, |this, cx| {
                    this.processes.list = Some(l);
                    cx.notify();
                });
            }
        })
        .detach();
    }

    fn load_history(&mut self, cx: &mut Context<Self>) {
        let fresh = self.processes.history_at.is_some_and(|at| at.elapsed() < HISTORY_EVERY);
        if fresh {
            return;
        }
        self.processes.history_at = Some(std::time::Instant::now());
        let http = self.store.read(cx).http.clone();
        cx.spawn(async move |this, cx| {
            let got = runtime::spawn(async move { http.get::<Vec<UsageSample>>("/api/processes/history").await }).await;
            if let Ok(Ok(h)) = got {
                let _ = this.update(cx, |this, cx| {
                    this.processes.history = h;
                    cx.notify();
                });
            }
        })
        .detach();
    }

    fn end_process(&mut self, path: String, cx: &mut Context<Self>) {
        let http = self.store.read(cx).http.clone();
        cx.spawn(async move |this, cx| {
            let _ = runtime::spawn(async move { http.delete(&path).await }).await;
            let _ = this.update(cx, |this, cx| this.load_processes(cx));
        })
        .detach();
    }

    pub(super) fn processes_view(&mut self, window: &mut Window, cx: &mut Context<Self>) -> AnyElement {
        let p = theme::palette(window);
        if self.processes.polling.is_none() {
            self.processes.polling = Some(cx.spawn(async move |this, cx| {
                loop {
                    let Ok(showing) = this.update(cx, |this, cx| {
                        let on = this.section == Section::Processes;
                        if on {
                            this.load_processes(cx);
                            this.load_history(cx);
                        }
                        on
                    }) else {
                        break;
                    };
                    if !showing {
                        let _ = this.update(cx, |this, _| this.processes.polling = None);
                        break;
                    }
                    cx.background_executor().timer(std::time::Duration::from_secs(5)).await;
                }
            }));
        }
        let Some(l) = self.processes.list.clone() else {
            return div()
                .text_sm()
                .text_color(p.text_muted)
                .child(t!("common.checking").into_owned())
                .into_any_element();
        };
        // Names read up front, so the rows below can use `cx` freely.
        let (chat_titles, agent_names): (
            std::collections::HashMap<String, String>,
            std::collections::HashMap<String, String>,
        ) = {
            let store = self.store.read(cx);
            (
                l.terminals
                    .iter()
                    .map(|t| {
                        (
                            t.chat_id.clone(),
                            store
                                .chat(&t.chat_id)
                                .map(crate::labels::chat_title)
                                .unwrap_or_default(),
                        )
                    })
                    .collect(),
                l.sessions
                    .iter()
                    .map(|s| (s.key.clone(), store.agent_name(s.agent_id.as_deref())))
                    .collect(),
            )
        };
        let line = |title: String, detail: String, cpu: f64, memory: f64, action: Option<AnyElement>| {
            div()
                .flex()
                .items_center()
                .gap(px(space::X3))
                .py(px(space::X2))
                .child(
                    div()
                        .flex()
                        .flex_col()
                        .flex_1()
                        .min_w_0()
                        .child(div().truncate().child(title))
                        .child(div().truncate().text_xs().text_color(p.text_muted).child(detail)),
                )
                .child(
                    div()
                        .flex_none()
                        .w(px(64.))
                        .text_right()
                        .text_sm()
                        .text_color(p.text_muted)
                        .child(format!("{cpu:.0}%")),
                )
                .child(
                    div()
                        .flex_none()
                        .w(px(72.))
                        .text_right()
                        .text_sm()
                        .text_color(p.text_muted)
                        .child(mb(memory)),
                )
                .children(action)
                .into_any_element()
        };
        let button = |id: String, label: String, path: String, cx: &mut Context<Self>| {
            Button::new(SharedString::from(id), label)
                .variant(Variant::Ghost)
                .size(Size::Xs)
                .on_click(cx.listener(move |this, _, _, cx| this.end_process(path.clone(), cx)))
                .into_any_element()
        };
        let mut groups: Vec<AnyElement> = Vec::new();
        let servers: Vec<AnyElement> = l
            .servers
            .iter()
            .filter(|s| !s.nested)
            .map(|s| {
                let ports = s
                    .ports
                    .iter()
                    .map(|p| format!(":{}", *p as i64))
                    .collect::<Vec<_>>()
                    .join(" ");
                line(
                    s.command.clone(),
                    format!("{} {ports}", s.folder),
                    s.cpu,
                    s.memory,
                    Some(button(
                        format!("stop-{}", s.pid),
                        t!("processes.stop").into_owned(),
                        format!("/api/processes/servers/{}", s.pid as i64),
                        cx,
                    )),
                )
            })
            .collect();
        if !servers.is_empty() {
            groups.push(group(t!("processes.kinds.server").into_owned(), servers, p).into_any_element());
        }
        let terminals: Vec<AnyElement> = l
            .terminals
            .iter()
            .map(|t| {
                let chat = chat_titles.get(&t.chat_id).cloned().unwrap_or_default();
                let state = if t.busy {
                    t!("processes.busy")
                } else {
                    t!("processes.idle")
                };
                line(
                    t.label
                        .clone()
                        .unwrap_or_else(|| t!("processes.shell", n = t.n as i64).into_owned()),
                    format!("{chat} · {state}"),
                    t.cpu,
                    t.memory,
                    None,
                )
            })
            .collect();
        if !terminals.is_empty() {
            groups.push(group(t!("processes.kinds.terminal").into_owned(), terminals, p).into_any_element());
        }
        let sessions: Vec<AnyElement> = l
            .sessions
            .iter()
            .map(|s| {
                let agent = agent_names.get(&s.key).cloned().unwrap_or_default();
                let key = s.key.clone();
                line(
                    t!("processes.session", agent = agent, harness = s.provider).into_owned(),
                    t!(
                        "processes.usedAgo",
                        age = format::age(s.used_at, format::now_ms(), format::lang())
                    )
                    .into_owned(),
                    s.cpu,
                    s.memory,
                    Some(button(
                        format!("close-{key}"),
                        t!("processes.close").into_owned(),
                        format!("/api/processes/sessions/{}", crate::net::http::uri_encode(&key)),
                        cx,
                    )),
                )
            })
            .collect();
        if !sessions.is_empty() {
            groups.push(group(t!("processes.kinds.session").into_owned(), sessions, p).into_any_element());
        }
        let connections: Vec<AnyElement> = l
            .connections
            .iter()
            .map(|c| {
                line(
                    c.name.clone(),
                    if c.local {
                        t!("processes.localConnection")
                    } else {
                        t!("processes.remoteConnection")
                    }
                    .into_owned(),
                    c.cpu,
                    c.memory,
                    Some(button(
                        format!("disc-{}", c.id),
                        t!("processes.disconnect").into_owned(),
                        format!("/api/processes/connections/{}", c.id),
                        cx,
                    )),
                )
            })
            .collect();
        if !connections.is_empty() {
            groups.push(group(t!("processes.kinds.connection").into_owned(), connections, p).into_any_element());
        }
        let top = self.usage_now(&l, window, cx);
        let day = self.usage_day(&l, window, cx);
        let split = usage_split(&l, window);
        div()
            .flex()
            .flex_col()
            .gap(px(space::X8))
            .child(top)
            .child(day)
            .children(split)
            .when(groups.is_empty(), |d| {
                d.child(crate::ui::scene::inset(
                    "processes-empty",
                    crate::ui::scene::Moment::Resting,
                    t!("processes.empty").into_owned(),
                    Some(t!("processes.emptyHint").into_owned().into()),
                    window,
                    cx,
                ))
            })
            .children(groups)
            .into_any_element()
    }
}

impl Settings {
    /// On top: the face and how Zorel feels now, in a sentence with its memory and CPU, and the live mark.
    fn usage_now(&self, l: &ProcessList, window: &Window, _: &mut Context<Self>) -> AnyElement {
        let p = theme::palette(window);
        let u = &l.usage;
        let feeling = mood(u.cpu, u.memory, u.total_memory);
        let stat = |label: String, value: String, hint: String, color: Rgba| {
            div()
                .flex()
                .flex_col()
                .flex_1()
                .gap(px(space::X1))
                .p(px(space::X4))
                .rounded(px(theme::tokens::RADIUS_CARD))
                .bg(p.bg_surface)
                .border_1()
                .border_color(p.border)
                .child(
                    div()
                        .flex()
                        .items_center()
                        .gap(px(space::X1_5))
                        .text_sm()
                        .text_color(p.text_muted)
                        .child(div().size(px(8.)).rounded_full().bg(color))
                        .child(label),
                )
                .child(div().text_size(px(22.)).font_weight(FontWeight::SEMIBOLD).child(value))
                .child(div().text_xs().text_color(p.text_dim).child(hint))
        };
        div()
            .flex()
            .flex_col()
            .gap(px(space::X4))
            .child(
                div()
                    .flex()
                    .items_center()
                    .gap(px(space::X3))
                    .child(AgentFace::new("processes-face", 0).size(36.))
                    .child(
                        div()
                            .flex()
                            .flex_col()
                            .flex_1()
                            .min_w_0()
                            .child(
                                div()
                                    .text_lg()
                                    .font_weight(FontWeight::SEMIBOLD)
                                    .child(t!(format!("processes.usage.mood.{feeling}")).into_owned()),
                            )
                            .child(
                                div().text_sm().text_color(p.text_muted).child(
                                    t!(
                                        "processes.usage.moodHint",
                                        memory = mb(u.memory),
                                        cpu = format!("{:.0}%", u.cpu)
                                    )
                                    .into_owned(),
                                ),
                            ),
                    )
                    .child(
                        div()
                            .flex()
                            .items_center()
                            .gap(px(space::X1_5))
                            .px(px(space::X2_5))
                            .py(px(space::X1))
                            .rounded_full()
                            .bg(crate::ui::motion::fade(p.success, 0.12))
                            .text_xs()
                            .text_color(p.success)
                            .child(div().size(px(6.)).rounded_full().bg(p.success))
                            .child(t!("processes.usage.live").into_owned()),
                    ),
            )
            .child(
                div()
                    .flex()
                    .gap(px(space::X3))
                    .child(stat(
                        t!("processes.usage.memory").into_owned(),
                        mb(u.memory),
                        t!("processes.usage.ofMemory", total = mb(u.total_memory)).into_owned(),
                        p.series_7,
                    ))
                    .child(stat(
                        t!("processes.usage.cpu").into_owned(),
                        format!("{:.0}%", u.cpu),
                        crate::i18n::tn("processes.usage.cores", u.cores as i64),
                        p.series_1,
                    )),
            )
            .into_any_element()
    }

    /// The last 24 hours: memory or CPU as an area over the day, its peak, and when.
    fn usage_day(&self, l: &ProcessList, window: &Window, cx: &mut Context<Self>) -> AnyElement {
        let p = theme::palette(window);
        let now = format::now_ms();
        let metric = self.processes.metric;
        let value = |s: &UsageSample| if metric == 0 { s.memory } else { s.cpu };
        let mut samples: Vec<(f64, f64)> = self
            .processes
            .history
            .iter()
            .filter(|s| now - s.at <= DAY_MS)
            .map(|s| (s.at, value(s)))
            .collect();
        // The reading now closes the line, so it reaches "now".
        samples.push((now, if metric == 0 { l.usage.memory } else { l.usage.cpu }));
        let peak = samples.iter().map(|(_, v)| *v).fold(0., f64::max);
        let top = (peak * 1.15).max(if metric == 0 { 64. * 1024. * 1024. } else { 10. });
        let points: Vec<(f32, f32)> = samples
            .iter()
            .map(|(at, v)| ((1. - (now - at) / DAY_MS) as f32, (v / top) as f32))
            .collect();
        let color = if metric == 0 { p.series_7 } else { p.series_1 };
        let view = cx.entity().downgrade();
        let pick: crate::ui::segmented::OnPick = Rc::new(move |ix, _, cx| {
            let _ = view.update(cx, |this, cx| {
                this.processes.metric = ix;
                cx.notify();
            });
        });
        let peak_text = if metric == 0 { mb(peak) } else { format!("{peak:.0}%") };
        let axis = |text: String| div().text_xs().text_color(p.text_dim).child(text);
        div()
            .flex()
            .flex_col()
            .gap(px(space::X3))
            .p(px(space::X4))
            .rounded(px(theme::tokens::RADIUS_CARD))
            .bg(p.bg_surface)
            .border_1()
            .border_color(p.border)
            .child(
                div()
                    .flex()
                    .items_center()
                    .gap(px(space::X2))
                    .child(
                        div()
                            .flex_1()
                            .font_weight(FontWeight::MEDIUM)
                            .child(t!("processes.usage.day").into_owned()),
                    )
                    .child(
                        div()
                            .text_xs()
                            .text_color(p.text_muted)
                            .child(t!("processes.usage.peak", value = peak_text).into_owned()),
                    )
                    .child(
                        Segmented::new(
                            "processes-metric",
                            t!("processes.usage.day").into_owned(),
                            vec![
                                t!("processes.usage.memory").into_owned().into(),
                                t!("processes.usage.cpu").into_owned().into(),
                            ],
                            metric,
                            pick,
                        )
                        .quiet(),
                    ),
            )
            .child(div().h(px(120.)).child(chart::area(points, color)))
            .child(
                div()
                    .flex()
                    .justify_between()
                    .child(axis(t!("processes.usage.ago").into_owned()))
                    .child(axis(t!("processes.usage.half").into_owned()))
                    .child(axis(t!("processes.usage.now").into_owned())),
            )
            .when(self.processes.history.len() < 2, |d| {
                d.child(
                    div()
                        .text_sm()
                        .text_color(p.text_muted)
                        .child(t!("processes.usage.dayEmpty").into_owned()),
                )
            })
            .into_any_element()
    }
}

/// Where Zorel's memory goes: one bar split by part in its colour, and a legend with each part's share.
fn usage_split(l: &ProcessList, window: &Window) -> Option<AnyElement> {
    let p = theme::palette(window);
    let tint = |id: &str| match id {
        "app" => p.series_1,
        "server" => p.series_2,
        "agents" => p.series_3,
        "terminals" => p.series_4,
        "connections" => p.series_5,
        _ => p.series_6,
    };
    let parts: Vec<(String, f64, Rgba)> = l
        .usage
        .parts
        .iter()
        .filter(|x| x.memory > 0.)
        .map(|x| {
            let id = x.id.to_string();
            (
                t!(format!("processes.usage.parts.{id}")).into_owned(),
                x.memory,
                tint(&id),
            )
        })
        .collect();
    let total: f64 = parts.iter().map(|(_, m, _)| m).sum();
    if total <= 0. {
        return None;
    }
    Some(
        div()
            .flex()
            .flex_col()
            .gap(px(space::X3))
            .child(
                div()
                    .text_sm()
                    .font_weight(FontWeight::MEDIUM)
                    .text_color(p.text_muted)
                    .child(t!("processes.usage.split").into_owned()),
            )
            .child(
                div()
                    .flex()
                    .h(px(10.))
                    .rounded_full()
                    .overflow_hidden()
                    .gap(px(2.))
                    .children(
                        parts
                            .iter()
                            .map(|(_, m, c)| div().h_full().flex_basis(relative((m / total) as f32)).bg(*c)),
                    ),
            )
            .child(
                div()
                    .flex()
                    .flex_wrap()
                    .gap_x(px(space::X5))
                    .gap_y(px(space::X2))
                    .children(parts.iter().map(|(name, m, c)| {
                        div()
                            .flex()
                            .items_center()
                            .gap(px(space::X1_5))
                            .text_sm()
                            .child(div().size(px(8.)).rounded_full().bg(*c))
                            .child(div().text_color(p.text_secondary).child(name.clone()))
                            .child(div().text_color(p.text_muted).child(mb(*m)))
                    })),
            )
            .into_any_element(),
    )
}

#[cfg(test)]
mod tests {
    use super::mood;

    #[test]
    fn the_mood_follows_how_much_of_the_computer_zorel_takes() {
        let gb = 1024. * 1024. * 1024.;
        assert_eq!(mood(3., 0.3 * gb, 16. * gb), "calm");
        assert_eq!(mood(40., 0.3 * gb, 16. * gb), "working");
        assert_eq!(mood(3., 2. * gb, 16. * gb), "working");
        assert_eq!(mood(200., 0.3 * gb, 16. * gb), "busy");
    }
}
