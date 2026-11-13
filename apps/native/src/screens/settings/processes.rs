// Settings › Processes (apps/web/src/features/processes.tsx): what runs in the background now, read every 5 s while the
// section shows: servers the agents started (Stop), shells (Close), agent sessions (Close), connections (Disconnect),
// each with its CPU and memory; and the computer's total use by part.
use super::*;

use crate::{
    net::types::ProcessList,
    ui::button::{Button, Size, Variant},
};

#[derive(Default)]
pub struct Processes {
    list: Option<ProcessList>,
    polling: Option<Task<()>>,
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
        let total = div()
            .flex()
            .gap(px(space::X6))
            .child(
                div()
                    .flex()
                    .flex_col()
                    .child(
                        div()
                            .text_sm()
                            .text_color(p.text_muted)
                            .child(t!("processes.usage.cpu").into_owned()),
                    )
                    .child(div().text_size(px(18.)).child(format!("{:.0}%", l.usage.cpu))),
            )
            .child(
                div()
                    .flex()
                    .flex_col()
                    .child(
                        div()
                            .text_sm()
                            .text_color(p.text_muted)
                            .child(t!("processes.usage.memory").into_owned()),
                    )
                    .child(div().text_size(px(18.)).child(mb(l.usage.memory)))
                    .child(
                        div()
                            .text_xs()
                            .text_color(p.text_dim)
                            .child(t!("processes.usage.ofMemory", total = mb(l.usage.total_memory)).into_owned()),
                    ),
            );
        div()
            .flex()
            .flex_col()
            .gap(px(space::X8))
            .child(total)
            .when(groups.is_empty(), |d| {
                d.child(
                    div()
                        .flex()
                        .flex_col()
                        .gap(px(space::X1))
                        .child(
                            div()
                                .font_weight(FontWeight::MEDIUM)
                                .child(t!("processes.empty").into_owned()),
                        )
                        .child(
                            div()
                                .text_sm()
                                .text_color(p.text_muted)
                                .child(t!("processes.emptyHint").into_owned()),
                        ),
                )
            })
            .children(groups)
            .into_any_element()
    }
}
