// Settings › Skills (apps/web/src/features/skills.tsx, the prototype's "Skills"): the procedures agents follow. Zorel's
// own (proposals waiting for you first, each opening to its steps with Keep / Discard; the ones in use with where they
// apply and Archive), then the SKILL.md files already on this computer (Claude Code, Codex, other agents, plugins),
// each turned on or off for Zorel's agents, and the switch that lets Claude Code and Codex use their own skills.
use super::*;

use crate::{
    net::types::{FileSkill, FileSkillSource, MemoryKind, MemoryState},
    ui::button::{Button, Size, Variant},
};

#[derive(Default)]
pub struct Skills {
    files: Option<Vec<FileSkill>>,
    /// The proposal open to read.
    reading: Option<String>,
}

impl Settings {
    fn load_file_skills(&mut self, cx: &mut Context<Self>) {
        let http = self.store.read(cx).http.clone();
        cx.spawn(async move |this, cx| {
            if let Ok(Ok(f)) =
                runtime::spawn(async move { http.get::<Vec<FileSkill>>("/api/skills/files").await }).await
            {
                let _ = this.update(cx, |this, cx| {
                    this.skills.files = Some(f);
                    cx.notify();
                });
            }
        })
        .detach();
    }

    /// Keeps, discards or archives a Zorel skill: at once here, then on the engine.
    fn set_skill(&mut self, id: String, state: &'static str, cx: &mut Context<Self>) {
        self.store.update(cx, |s, cx| {
            match state {
                "active" => {
                    if let Some(m) = s.memories.iter_mut().find(|m| m.id == id) {
                        m.state = MemoryState::Active;
                    }
                }
                _ => s.memories.retain(|m| m.id != id),
            }
            cx.notify();
        });
        self.store.update(cx, |s, cx| {
            let body = json!({ "state": state });
            s.write(
                crate::state::store::Method::Patch,
                format!("/api/memories/{id}"),
                body,
                cx,
            )
            .detach()
        });
    }

    fn pick_file_skill(&mut self, path: String, enabled: bool, cx: &mut Context<Self>) {
        if let Some(f) = self
            .skills
            .files
            .as_mut()
            .and_then(|l| l.iter_mut().find(|f| f.path == path))
        {
            f.enabled = enabled;
        }
        cx.notify();
        let http = self.store.read(cx).http.clone();
        cx.spawn(async move |this, cx| {
            let got = runtime::spawn(async move {
                http.patch::<_, Vec<FileSkill>>("/api/skills/files", &json!({ "path": path, "enabled": enabled }))
                    .await
            })
            .await;
            let _ = this.update(cx, |this, cx| {
                if let Ok(Ok(f)) = got {
                    this.skills.files = Some(f);
                } else {
                    this.load_file_skills(cx);
                }
                cx.notify();
            });
        })
        .detach();
    }

    fn scope_label(&self, scope: &str, cx: &App) -> String {
        let store = self.store.read(cx);
        match scope.split_once(':') {
            Some(("project", id)) => store
                .projects
                .iter()
                .find(|p| p.id == id)
                .map_or(id.to_string(), |p| p.name.clone()),
            Some(("agent", id)) => store.agent_name(Some(id)),
            _ => t!("agents.global").into_owned(),
        }
    }

    pub(super) fn skills_view(&mut self, window: &mut Window, cx: &mut Context<Self>) -> AnyElement {
        let p = theme::palette(window);
        if self.skills.files.is_none() {
            self.skills.files = Some(Vec::new());
            self.load_file_skills(cx);
        }
        let mine: Vec<crate::net::types::Memory> = self
            .store
            .read(cx)
            .memories
            .iter()
            .filter(|m| matches!(m.kind, MemoryKind::Skill) && !matches!(m.state, MemoryState::Forgotten))
            .cloned()
            .collect();
        let (pending, active): (Vec<_>, Vec<_>) =
            mine.into_iter().partition(|m| matches!(m.state, MemoryState::Pending));
        let mut rows: Vec<AnyElement> = Vec::new();
        for m in pending.iter().chain(active.iter()) {
            let waiting = matches!(m.state, MemoryState::Pending);
            let open = self.skills.reading.as_deref() == Some(m.id.as_str());
            let scope = self.scope_label(&m.scope, cx);
            let hint = if waiting {
                crate::i18n::tn("skills.waiting", 1)
            } else {
                match m.origin {
                    crate::net::types::MemoryOrigin::Auto => t!("skills.fromChat").into_owned(),
                    _ => t!("skills.added").into_owned(),
                }
            };
            let (read_id, keep_id, drop_id) = (m.id.clone(), m.id.clone(), m.id.clone());
            let action: AnyElement = if waiting {
                Button::new(
                    SharedString::from(format!("skill-review-{}", m.id)),
                    t!("settings.review").into_owned(),
                )
                .variant(Variant::Primary)
                .size(Size::Xs)
                .on_click(cx.listener(move |this, _, _, cx| {
                    this.skills.reading = if this.skills.reading.as_deref() == Some(read_id.as_str()) {
                        None
                    } else {
                        Some(read_id.clone())
                    };
                    cx.notify();
                }))
                .into_any_element()
            } else {
                Button::new(
                    SharedString::from(format!("skill-archive-{}", m.id)),
                    t!("settings.archive").into_owned(),
                )
                .variant(Variant::Ghost)
                .size(Size::Xs)
                .on_click(cx.listener(move |this, _, _, cx| this.set_skill(drop_id.clone(), "forgotten", cx)))
                .into_any_element()
            };
            let body = (open || !waiting && self.skills.reading.as_deref() == Some(m.id.as_str())).then(|| {
                let drop_id = m.id.clone();
                div()
                    .flex()
                    .flex_col()
                    .gap(px(space::X2))
                    .p(px(space::X3))
                    .rounded(px(crate::theme::tokens::RADIUS_CONTROL))
                    .bg(p.bg_code)
                    .child(div().text_sm().text_color(p.text_secondary).child(m.text.clone()))
                    .child(
                        div()
                            .flex()
                            .justify_end()
                            .gap(px(space::X2))
                            .child(
                                Button::new(
                                    SharedString::from(format!("skill-drop-{}", m.id)),
                                    t!("agent.discard").into_owned(),
                                )
                                .variant(Variant::Ghost)
                                .size(Size::Sm)
                                .on_click(
                                    cx.listener(move |this, _, _, cx| this.set_skill(drop_id.clone(), "forgotten", cx)),
                                ),
                            )
                            .child(
                                Button::new(
                                    SharedString::from(format!("skill-keep-{}", m.id)),
                                    t!("settings.keep").into_owned(),
                                )
                                .variant(Variant::Primary)
                                .size(Size::Sm)
                                .on_click(
                                    cx.listener(move |this, _, _, cx| this.set_skill(keep_id.clone(), "active", cx)),
                                ),
                            ),
                    )
            });
            rows.push(
                div()
                    .flex()
                    .flex_col()
                    .gap(px(space::X2))
                    .py(px(space::X2_5))
                    .child(
                        div()
                            .flex()
                            .items_center()
                            .gap(px(space::X3))
                            .child(
                                div()
                                    .flex()
                                    .flex_col()
                                    .flex_1()
                                    .min_w_0()
                                    .child(div().font_weight(FontWeight::MEDIUM).child(if m.title.is_empty() {
                                        m.text.lines().next().unwrap_or_default().to_string()
                                    } else {
                                        m.title.clone()
                                    }))
                                    .child(
                                        div()
                                            .text_sm()
                                            .text_color(if waiting { p.accent_text } else { p.text_muted })
                                            .child(hint),
                                    ),
                            )
                            .child(div().text_sm().text_color(p.text_muted).child(scope))
                            .child(action),
                    )
                    .children(body)
                    .into_any_element(),
            );
        }
        // The SKILL.md files on this computer.
        let files = self.skills.files.clone().unwrap_or_default();
        let file_rows: Vec<AnyElement> = files
            .iter()
            .map(|f| {
                let source = match f.source {
                    FileSkillSource::Claude => t!("skills.source.claude"),
                    FileSkillSource::Codex => t!("skills.source.codex"),
                    FileSkillSource::Agents => t!("skills.source.agents"),
                    FileSkillSource::Plugin => t!("skills.source.plugin"),
                }
                .into_owned();
                let (path, view) = (f.path.clone(), cx.entity().downgrade());
                div()
                    .flex()
                    .items_center()
                    .gap(px(space::X3))
                    .py(px(space::X2_5))
                    .child(
                        div()
                            .flex()
                            .flex_col()
                            .flex_1()
                            .min_w_0()
                            .child(div().font_weight(FontWeight::MEDIUM).child(f.name.clone()))
                            .child(div().truncate().text_sm().text_color(p.text_muted).child(
                                if f.description.is_empty() {
                                    source.clone()
                                } else {
                                    format!("{source} · {}", f.description)
                                },
                            )),
                    )
                    .child(switch(
                        SharedString::from(format!("file-skill-{}", f.path)),
                        String::new(),
                        f.enabled,
                        Rc::new(move |on, _, cx| {
                            let path = path.clone();
                            let _ = view.update(cx, |this, cx| this.pick_file_skill(path, on, cx));
                        }),
                        window,
                        cx,
                    ))
                    .into_any_element()
            })
            .collect();
        let native = self.prefs.as_ref().is_some_and(|p| p.native_skills);
        let view = cx.entity().downgrade();
        let native_switch = switch(
            "native-skills",
            String::new(),
            native,
            Rc::new(move |on, _, cx| {
                let _ = view.update(cx, |this, cx| {
                    this.put_pref("native-skills", json!({ "enabled": on }), cx)
                });
            }),
            window,
            cx,
        );
        div()
            .flex()
            .flex_col()
            .gap(px(space::X8))
            .child(
                div()
                    .flex()
                    .flex_col()
                    .child(
                        div()
                            .text_sm()
                            .text_color(p.text_muted)
                            .pb(px(space::X1))
                            .child(t!("settings.zorelSkills").into_owned()),
                    )
                    .when(rows.is_empty(), |d| {
                        d.child(crate::ui::scene::inset(
                            "skills-empty",
                            crate::ui::scene::Moment::Notebook,
                            t!("skills.noneYet").into_owned(),
                            Some(t!("skills.noneYetHint").into_owned().into()),
                            window,
                            cx,
                        ))
                    })
                    .children(rows),
            )
            .when(!file_rows.is_empty(), |d| {
                d.child(
                    div()
                        .flex()
                        .flex_col()
                        .child(
                            div()
                                .text_sm()
                                .text_color(p.text_muted)
                                .pb(px(space::X1))
                                .child(t!("settings.fileSkills").into_owned()),
                        )
                        .children(file_rows),
                )
            })
            .child(group(
                String::new(),
                vec![row(
                    t!("skills.native").into_owned(),
                    t!("skills.nativeHint").into_owned(),
                    native_switch,
                    p,
                )],
                p,
            ))
            .child(
                div()
                    .text_sm()
                    .text_color(p.text_muted)
                    .child(t!("settings.skillsNote").into_owned()),
            )
            .into_any_element()
    }
}
