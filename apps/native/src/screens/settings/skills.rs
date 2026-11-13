// Settings › Skills (apps/web/src/features/skills.tsx, the prototype's "Skills"): the procedures agents follow. On top
// the switch that lets Claude Code and Codex use their own skills ("New skill" is in the window's strip, a dialog); then Zorel's own (proposals waiting
// for you first, then the ones in use) and the SKILL.md files already on this computer (Claude Code, Codex, other
// agents, plugins), each turned on or off for Zorel's agents. A row opens its skill in the section's place: Zorel's
// with its steps and Keep / Discard or Archive; a file's with where it comes from, its switch and the file itself.
use super::*;

use crate::{
    net::types::{FileSkill, FileSkillSource, Memory, MemoryKind, MemoryOrigin, MemoryState},
    state::store::Method,
    ui::{
        button::{Button, Size, Variant},
        markdown,
    },
};
use gpui_kit::{
    base::input::{Textarea, TextareaState},
    component::WindowExt as _,
    component::input::{Input, InputState},
};

/// What the section shows: the list, or one skill open.
#[derive(Default, Clone, PartialEq)]
enum Page {
    #[default]
    List,
    Zorel(String),
    File(String),
}

#[derive(Default)]
pub struct Skills {
    files: Option<Vec<FileSkill>>,
    page: Page,
    /// The open file skill's SKILL.md, read from this computer (None: it couldn't be read).
    file_text: Option<(String, Option<Rc<Vec<markdown::Block>>>)>,
}

fn source_of(f: &FileSkill) -> String {
    match f.source {
        FileSkillSource::Claude => t!("skills.source.claude"),
        FileSkillSource::Codex => t!("skills.source.codex"),
        FileSkillSource::Agents => t!("skills.source.agents"),
        FileSkillSource::Plugin => t!("skills.source.plugin"),
    }
    .into_owned()
}

fn title_of(m: &Memory) -> String {
    if m.title.is_empty() {
        m.text.lines().next().unwrap_or_default().to_string()
    } else {
        m.title.clone()
    }
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

    fn open_skill(&mut self, page: Page, cx: &mut Context<Self>) {
        self.skills.page = page;
        self.scroll.set_offset(point(px(0.), px(0.)));
        cx.notify();
    }

    /// Keeps, discards or archives a Zorel skill: at once here, then on the engine.
    fn set_skill(&mut self, id: String, state: MemoryState, cx: &mut Context<Self>) {
        self.store.update(cx, |s, cx| {
            match state {
                MemoryState::Active => {
                    if let Some(m) = s.memories.iter_mut().find(|m| m.id == id) {
                        m.state = MemoryState::Active;
                    }
                }
                _ => s.memories.retain(|m| m.id != id),
            }
            cx.notify();
            let body = json!({ "state": state.to_string() });
            s.write(Method::Patch, format!("/api/memories/{id}"), body, cx).detach()
        });
        self.open_skill(Page::List, cx);
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
        if self.skills.files.is_none() {
            self.skills.files = Some(Vec::new());
            self.load_file_skills(cx);
        }
        match self.skills.page.clone() {
            Page::List => self.skills_list(window, cx),
            Page::Zorel(id) => self.zorel_skill(&id, window, cx),
            Page::File(path) => self.file_skill(&path, window, cx),
        }
    }

    /// Back to the list, left-aligned with the page's words.
    fn back_to_skills(&self, cx: &mut Context<Self>) -> Div {
        div().flex().ml(px(-space::X2_5)).child(
            Button::new("skills-back", t!("settings.skills").into_owned())
                .icon(IconName::ChevronLeft)
                .variant(Variant::Ghost)
                .size(Size::Sm)
                .on_click(cx.listener(|this, _, _, cx| this.open_skill(Page::List, cx))),
        )
    }

    fn skills_list(&mut self, window: &mut Window, cx: &mut Context<Self>) -> AnyElement {
        let p = theme::palette(window);
        let mine: Vec<Memory> = self
            .store
            .read(cx)
            .memories
            .iter()
            .filter(|m| matches!(m.kind, MemoryKind::Skill) && !matches!(m.state, MemoryState::Forgotten))
            .cloned()
            .collect();
        let (pending, active): (Vec<_>, Vec<_>) =
            mine.into_iter().partition(|m| matches!(m.state, MemoryState::Pending));
        let rows: Vec<AnyElement> = pending
            .iter()
            .chain(active.iter())
            .map(|m| {
                let waiting = matches!(m.state, MemoryState::Pending);
                let hint = if waiting {
                    crate::i18n::tn("skills.waiting", 1)
                } else {
                    match m.origin {
                        MemoryOrigin::Auto => t!("skills.fromChat").into_owned(),
                        _ => t!("skills.added").into_owned(),
                    }
                };
                let open = m.id.clone();
                div()
                    .id(SharedString::from(format!("skill-{}", m.id)))
                    .flex()
                    .items_center()
                    .gap(px(space::X3))
                    .py(px(space::X2_5))
                    .px(px(space::X3))
                    .rounded(px(theme::tokens::RADIUS_ROW))
                    .cursor_pointer()
                    .hover(|d| d.bg(p.bg_control))
                    .child(
                        div()
                            .flex()
                            .flex_col()
                            .flex_1()
                            .min_w_0()
                            .child(div().font_weight(FontWeight::MEDIUM).truncate().child(title_of(m)))
                            .child(
                                div()
                                    .text_sm()
                                    .text_color(if waiting { p.accent_text } else { p.text_muted })
                                    .child(format!("{hint} · {}", self.scope_label(&m.scope, cx))),
                            ),
                    )
                    .when(waiting, |d| {
                        d.child(
                            Button::new(
                                SharedString::from(format!("skill-review-{}", m.id)),
                                t!("settings.review").into_owned(),
                            )
                            .variant(Variant::Primary)
                            .size(Size::Xs)
                            .on_click({
                                let open = open.clone();
                                cx.listener(move |this, _, _, cx| this.open_skill(Page::Zorel(open.clone()), cx))
                            }),
                        )
                    })
                    .on_click(cx.listener(move |this, _, _, cx| this.open_skill(Page::Zorel(open.clone()), cx)))
                    .into_any_element()
            })
            .collect();
        let files = self.skills.files.clone().unwrap_or_default();
        let file_rows: Vec<AnyElement> = files
            .iter()
            .map(|f| {
                let source = source_of(f);
                let (path, open, view) = (f.path.clone(), f.path.clone(), cx.entity().downgrade());
                div()
                    .id(SharedString::from(format!("file-skill-row-{}", f.path)))
                    .flex()
                    .items_center()
                    .gap(px(space::X3))
                    .py(px(space::X2_5))
                    .px(px(space::X3))
                    .rounded(px(theme::tokens::RADIUS_ROW))
                    .cursor_pointer()
                    .hover(|d| d.bg(p.bg_control))
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
                    .on_click(cx.listener(move |this, _, _, cx| this.open_skill(Page::File(open.clone()), cx)))
                    .into_any_element()
            })
            .collect();
        let nothing = rows.is_empty() && file_rows.is_empty();
        div()
            .flex()
            .flex_col()
            .gap(px(space::X8))
            // On top: whether Claude Code and Codex use their own skills ("New skill" sits in the window's strip).
            .child(group(
                String::new(),
                vec![row(
                    t!("skills.native").into_owned(),
                    t!("skills.nativeHint").into_owned(),
                    self.native_skills_switch(window, cx),
                    p,
                )],
                p,
            ))
            .when(nothing, |d| {
                d.child(crate::ui::scene::inset(
                    "skills-empty",
                    crate::ui::scene::Moment::Notebook,
                    t!("skills.noneYet").into_owned(),
                    Some(t!("skills.noneYetHint").into_owned().into()),
                    window,
                    cx,
                ))
            })
            .when(!rows.is_empty(), |d| {
                d.child(list(t!("settings.zorelSkills").into_owned(), rows, space::X3, p))
            })
            .when(!file_rows.is_empty(), |d| {
                d.child(list(t!("settings.fileSkills").into_owned(), file_rows, space::X3, p))
            })
            .into_any_element()
    }

    fn native_skills_switch(&mut self, window: &mut Window, cx: &mut Context<Self>) -> AnyElement {
        let native = self.prefs.as_ref().is_some_and(|p| p.native_skills);
        let view = cx.entity().downgrade();
        switch(
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
        )
    }

    /// A Zorel skill: its title, where it applies and where it came from, its steps, and what to do with it.
    fn zorel_skill(&mut self, id: &str, window: &mut Window, cx: &mut Context<Self>) -> AnyElement {
        let p = theme::palette(window);
        let Some(m) = self.store.read(cx).memories.iter().find(|m| m.id == id).cloned() else {
            return self.skills_list(window, cx);
        };
        let waiting = matches!(m.state, MemoryState::Pending);
        let origin = match m.origin {
            MemoryOrigin::Auto => t!("knowledge.learned"),
            _ => t!("knowledge.added"),
        };
        let blocks = markdown::parse(&m.text);
        let (keep, drop) = (m.id.clone(), m.id.clone());
        let actions = if waiting {
            div()
                .flex()
                .gap(px(space::X2))
                .child(
                    Button::new("skill-keep", t!("settings.keep").into_owned())
                        .variant(Variant::Primary)
                        .size(Size::Sm)
                        .on_click(
                            cx.listener(move |this, _, _, cx| this.set_skill(keep.clone(), MemoryState::Active, cx)),
                        ),
                )
                .child(
                    Button::new("skill-drop", t!("agent.discard").into_owned())
                        .variant(Variant::Ghost)
                        .size(Size::Sm)
                        .on_click(
                            cx.listener(move |this, _, _, cx| this.set_skill(drop.clone(), MemoryState::Forgotten, cx)),
                        ),
                )
        } else {
            div().flex().child(
                Button::new("skill-archive", t!("settings.archive").into_owned())
                    .variant(Variant::Ghost)
                    .size(Size::Sm)
                    .on_click(
                        cx.listener(move |this, _, _, cx| this.set_skill(drop.clone(), MemoryState::Forgotten, cx)),
                    ),
            )
        };
        div()
            .flex()
            .flex_col()
            .gap(px(space::X5))
            .child(self.back_to_skills(cx))
            .child(
                div()
                    .flex()
                    .flex_col()
                    .gap(px(space::X1_5))
                    .child(
                        div()
                            .text_xs()
                            .font_weight(FontWeight::MEDIUM)
                            .text_color(p.text_muted)
                            .child(t!("knowledge.skill").into_owned()),
                    )
                    .child(div().text_lg().font_weight(FontWeight::SEMIBOLD).child(title_of(&m)))
                    .child(
                        div()
                            .text_sm()
                            .text_color(p.text_muted)
                            .child(format!("{} · {origin}", self.scope_label(&m.scope, cx))),
                    ),
            )
            .child(
                div()
                    .p(px(space::X4))
                    .rounded(px(theme::tokens::RADIUS_CARD))
                    .border_1()
                    .border_color(p.border)
                    .bg(p.bg_surface)
                    .child(markdown::render(&format!("skill-text-{}", m.id), &blocks, window)),
            )
            .child(actions)
            .into_any_element()
    }

    /// A skill on this computer: where it comes from and its file, whether Zorel's agents use it, and the file itself
    /// (read from disk each time it opens, so edits show).
    fn file_skill(&mut self, path: &str, window: &mut Window, cx: &mut Context<Self>) -> AnyElement {
        let p = theme::palette(window);
        let Some(f) = self
            .skills
            .files
            .as_ref()
            .and_then(|l| l.iter().find(|f| f.path == path))
            .cloned()
        else {
            return self.skills_list(window, cx);
        };
        if self.skills.file_text.as_ref().is_none_or(|(at, _)| at != path) {
            let text = std::fs::read_to_string(path)
                .ok()
                .map(|t| Rc::new(markdown::parse(strip_front_matter(&t))));
            self.skills.file_text = Some((path.to_string(), text));
        }
        let text = self.skills.file_text.as_ref().and_then(|(_, t)| t.clone());
        let (toggle, view) = (f.path.clone(), cx.entity().downgrade());
        let use_here = switch(
            SharedString::from(format!("file-skill-page-{}", f.path)),
            String::new(),
            f.enabled,
            Rc::new(move |on, _, cx| {
                let path = toggle.clone();
                let _ = view.update(cx, |this, cx| this.pick_file_skill(path, on, cx));
            }),
            window,
            cx,
        );
        div()
            .flex()
            .flex_col()
            .gap(px(space::X5))
            .child(self.back_to_skills(cx))
            .child(
                div()
                    .flex()
                    .flex_col()
                    .gap(px(space::X1_5))
                    .child(
                        div()
                            .text_xs()
                            .font_weight(FontWeight::MEDIUM)
                            .text_color(p.text_muted)
                            .child(source_of(&f)),
                    )
                    .child(div().text_lg().font_weight(FontWeight::SEMIBOLD).child(f.name.clone()))
                    .child(
                        div()
                            .text_sm()
                            .font_family(crate::ui::code::MONO)
                            .text_color(p.text_muted)
                            .child(f.path.clone()),
                    ),
            )
            .when(!f.description.is_empty(), |d| {
                d.child(div().text_color(p.text_secondary).child(f.description.clone()))
            })
            .child(group(
                String::new(),
                vec![row(
                    t!("skills.useHere").into_owned(),
                    t!("skills.useHereHint").into_owned(),
                    use_here,
                    p,
                )],
                p,
            ))
            .child(
                div()
                    .p(px(space::X4))
                    .rounded(px(theme::tokens::RADIUS_CARD))
                    .border_1()
                    .border_color(p.border)
                    .bg(p.bg_surface)
                    .child(match text {
                        Some(blocks) => {
                            markdown::render(&format!("file-skill-text-{}", f.path), &blocks, window).into_any_element()
                        }
                        None => div()
                            .text_sm()
                            .text_color(p.text_muted)
                            .child(t!("common.loadFailed").into_owned())
                            .into_any_element(),
                    }),
            )
            .into_any_element()
    }
}

impl Settings {
    /// "New skill" (the window's strip, on Skills): a dialog with where it applies, its title and its steps.
    pub fn new_skill_dialog(settings: &Entity<Settings>, window: &mut Window, cx: &mut App) {
        let store = settings.read(cx).store.clone();
        let title = cx.new(|cx| InputState::new(window, cx).placeholder(t!("knowledge.titleField").into_owned()));
        let steps = cx.new(|cx| {
            let mut t = TextareaState::new(window, cx).placeholder(t!("knowledge.steps").into_owned());
            t.set_auto_grow(8, 16, cx);
            t
        });
        let scope = Rc::new(std::cell::RefCell::new("user".to_string()));
        let options: Vec<SelectOption> = {
            let s = store.read(cx);
            std::iter::once(SelectOption {
                id: "user".into(),
                label: t!("scope.user").into_owned().into(),
                mark: select::Mark::None,
            })
            .chain(s.projects.iter().map(|pr| SelectOption {
                id: format!("project:{}", pr.id),
                label: t!("scope.project", name = pr.name).into_owned().into(),
                mark: select::Mark::None,
            }))
            .chain(
                s.agents
                    .iter()
                    .filter(|a| a.builtin.is_none() && a.archived_at.is_none())
                    .map(|a| SelectOption {
                        id: format!("agent:{}", a.id),
                        label: t!("scope.agent", name = a.name).into_owned().into(),
                        mark: select::Mark::None,
                    }),
            )
            .collect()
        };
        let focus = std::cell::Cell::new(true);
        window.open_dialog(cx, move |dialog, window, cx| {
            if focus.replace(false) {
                title.focus_handle(cx).focus(window, cx);
            }
            let p = theme::palette(window);
            let picked = scope.clone();
            let pick = Select::new(
                "skill-new-scope",
                t!("knowledge.scope").into_owned(),
                options.clone(),
                scope.borrow().clone(),
                Rc::new(move |v, window, _| {
                    *picked.borrow_mut() = v.to_string();
                    window.refresh();
                }),
            )
            .filled();
            let framed = |el: AnyElement| {
                div()
                    .px(px(space::X2_5))
                    .py(px(space::X1_5))
                    .rounded(px(theme::tokens::RADIUS_CONTROL))
                    .border_1()
                    .border_color(p.border_strong)
                    .bg(p.bg_field)
                    .child(el)
                    .into_any_element()
            };
            let body = div()
                .flex()
                .flex_col()
                .gap(px(space::X4))
                .child(crate::ui::drawer::field(
                    t!("knowledge.scope").into_owned(),
                    None,
                    div().w_full().child(pick).into_any_element(),
                    window,
                ))
                .child(crate::ui::drawer::field(
                    t!("knowledge.titleField").into_owned(),
                    None,
                    framed(Input::new(&title).appearance(false).into_any_element()),
                    window,
                ))
                .child(crate::ui::drawer::field(
                    t!("knowledge.steps").into_owned(),
                    None,
                    framed(Textarea::new(&steps).into_any_element()),
                    window,
                ));
            let ready = !title.read(cx).value().trim().is_empty() && !steps.read(cx).value().trim().is_empty();
            let (t2, s2, scope2, store2) = (title.clone(), steps.clone(), scope.clone(), store.clone());
            crate::ui::dialog::sheet(
                dialog,
                window,
                crate::ui::dialog::Width::Lg,
                crate::ui::dialog::Sheet {
                    title: t!("knowledge.newSkill").into_owned(),
                    description: None,
                    body: Some(body.into_any_element()),
                    actions: vec![
                        Button::new("cancel", t!("common.cancel").into_owned())
                            .on_click(|_, window, cx| window.close_dialog(cx))
                            .into_any_element(),
                        Button::new("create", t!("common.create").into_owned())
                            .variant(Variant::Primary)
                            .disabled(!ready)
                            .on_click(move |_, window, cx| {
                                let title = t2.read(cx).value().trim().to_string();
                                let text = s2.read(cx).value().trim().to_string();
                                if title.is_empty() || text.is_empty() {
                                    return;
                                }
                                let body =
                                    json!({ "scope": *scope2.borrow(), "kind": "skill", "title": title, "text": text });
                                window.close_dialog(cx);
                                store2.update(cx, |s, cx| s.write(Method::Post, "/api/memories", body, cx).detach());
                            })
                            .into_any_element(),
                    ],
                },
            )
        });
    }
}

/// A SKILL.md without its YAML front matter (name and description already show above it).
fn strip_front_matter(text: &str) -> &str {
    text.strip_prefix("---")
        .and_then(|rest| rest.split_once("\n---"))
        .map_or(text, |(_, body)| body.trim_start_matches(['\r', '\n']))
}

#[cfg(test)]
mod tests {
    use super::strip_front_matter;

    #[test]
    fn a_skill_file_shows_without_its_front_matter() {
        assert_eq!(strip_front_matter("---\nname: x\n---\n\n# Steps"), "# Steps");
        assert_eq!(strip_front_matter("# No header"), "# No header");
    }
}
