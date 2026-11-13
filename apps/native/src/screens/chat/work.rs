// Steps: a run of them as one folded line that opens to each (finished and live), and each step's row.
use super::*;

impl ChatScreen {
    /// One folded line of work ("Read 2 files and ran 3 commands · 1 failed · 12s") that opens to its steps.
    pub(super) fn activity(
        &mut self,
        key: &str,
        all: &[Step],
        took: Option<f64>,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> AnyElement {
        let p = theme::palette(window);
        let summed: Vec<Summed> = all
            .iter()
            .map(|s| Summed {
                kind: &s.tool,
                status: status_of(&s.status),
                detail: s.detail.as_deref().filter(|d| !d.is_empty()).unwrap_or(&s.args),
                files: if s.tool == "edit" {
                    s.args.split(", ").filter(|f| !f.is_empty()).collect()
                } else {
                    Vec::new()
                },
            })
            .collect();
        let summary = steps::summarize(&summed);
        let open = self.open.contains(key);
        let shown: Vec<&Step> = all
            .iter()
            .filter(|s| s.tool != "thought" || s.ms.unwrap_or(0.) >= 1000.)
            .collect();
        let l = format::lang();
        let mut parts: Vec<AnyElement> = vec![div().truncate().child(steps::sentence(&summary)).into_any_element()];
        if summary.failed > 0 {
            parts.push(
                div()
                    .flex_none()
                    .text_color(p.danger)
                    .child(format!("· {}", tn("activity.errors", summary.failed as i64)))
                    .into_any_element(),
            );
        }
        if summary.refused > 0 {
            parts.push(
                div()
                    .flex_none()
                    .text_color(p.warning)
                    .child(format!("· {}", tn("activity.refused", summary.refused as i64)))
                    .into_any_element(),
            );
        }
        if let Some(ms) = took.filter(|ms| *ms >= 1000.) {
            parts.push(
                div()
                    .flex_none()
                    .text_color(p.text_dim)
                    .child(format!("· {}", format::duration(ms, l)))
                    .into_any_element(),
            );
        }
        let view = cx.entity().downgrade();
        let head_key = key.to_string();
        let toggle: step_tree::OnToggle = Rc::new(move |_, cx| {
            let _ = view.update(cx, |this, cx| this.toggle(head_key.clone(), cx));
        });
        let head = step_tree::head(
            step_tree::Head {
                key: key.to_string(),
                open,
                rows: !shown.is_empty(),
                leading: None,
                parts,
                on_toggle: toggle,
            },
            window,
            cx,
        );
        // The last step that is work (a thought after it doesn't carry the trunk on).
        let last_work = shown.iter().rposition(|s| s.tool != "thought");
        let list = open.then(|| {
            let rows: Vec<AnyElement> = shown
                .iter()
                .enumerate()
                .map(|(n, s)| {
                    if s.tool == "thought" {
                        step_tree::note(
                            t!("activity.thought", time = format::duration(s.ms.unwrap_or(0.), l)).into_owned(),
                            last_work.is_none_or(|w| n > w),
                            window,
                        )
                    } else {
                        self.stored_step(&format!("{key}-{n}"), s, Some(n) == last_work, window, cx)
                    }
                })
                .collect();
            motion::enter(
                step_tree::list(rows),
                SharedString::from(format!("fold-{key}")),
                motion::MENU_IN_MS,
                4.,
            )
        });
        div().flex().flex_col().child(head).children(list).into_any_element()
    }

    /// One finished step: its title in plain words (the command, path or URL on hover), how long it took or that it
    /// failed; it opens to the whole command and the start of its output.
    pub(super) fn stored_step(
        &mut self,
        key: &str,
        s: &Step,
        last: bool,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> AnyElement {
        let p = theme::palette(window);
        let title = s
            .title
            .clone()
            .filter(|t| !t.is_empty())
            .unwrap_or_else(|| match s.tool.as_str() {
                "run" => format!("$ {}", s.args),
                "read" | "search" => format!("{} {}", s.tool, s.args),
                "edit" => s.args.clone(),
                other => other.to_string(),
            });
        let command = if s.tool == "run" {
            s.args.clone()
        } else {
            s.detail.clone().unwrap_or_default()
        };
        let hint = s
            .detail
            .clone()
            .filter(|d| !d.is_empty())
            .or_else(|| (s.tool == "run").then(|| s.args.clone()))
            .filter(|h| *h != title);
        let (tone, fact) = match s.status {
            StepStatus::Error => (
                step_tree::Tone::Danger,
                Some((t!("activity.failedStep").into_owned(), p.danger)),
            ),
            StepStatus::Refused => (
                step_tree::Tone::Warning,
                Some((t!("activity.refusedStep").into_owned(), p.warning)),
            ),
            _ => (
                step_tree::Tone::Default,
                s.ms.filter(|ms| *ms >= 1000.)
                    .map(|ms| (format::duration(ms, format::lang()), p.text_dim)),
            ),
        };
        let can_open = !command.is_empty() || !s.result.is_empty();
        let open = self.open.contains(key);
        let toggle = can_open.then(|| {
            let (view, k) = (cx.entity().downgrade(), key.to_string());
            Rc::new(move |_: &mut Window, cx: &mut App| {
                let _ = view.update(cx, |this, cx| this.toggle(k.clone(), cx));
            }) as step_tree::OnToggle
        });
        let result: String = s.result.lines().take(3).collect::<Vec<_>>().join("\n");
        let mut body = Vec::new();
        if !command.is_empty() {
            body.push(code_box(command, p.text_secondary, p).into_any_element());
        }
        if !result.is_empty() {
            body.push(code_box(result, p.text_muted, p).into_any_element());
        }
        step_tree::Row {
            key: key.to_string(),
            icon: icon(glyph_of(&s.tool), icon::XS).into_any_element(),
            tone,
            title,
            facts: fact
                .map(|(f, c)| div().text_color(c).child(f).into_any_element())
                .into_iter()
                .collect(),
            hint,
            last,
            open,
            on_toggle: toggle,
            body,
        }
        .render(window, cx)
    }

    /// One run of a live turn's steps: its summary (a turning mark while one runs, the clock while one waits for
    /// you) and, open by default, its steps on the tree as they come.
    pub(super) fn live_group(
        &mut self,
        key: &str,
        group: &[WorkStep],
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> AnyElement {
        let p = theme::palette(window);
        let kinds: Vec<String> = group.iter().map(|s| s.kind.to_string()).collect();
        let summed: Vec<Summed> = group
            .iter()
            .zip(&kinds)
            .map(|(s, kind)| Summed {
                kind,
                status: match s.status {
                    WorkStepStatus::Error => "error",
                    WorkStepStatus::Refused => "refused",
                    _ => "ok",
                },
                detail: if s.detail.is_empty() { &s.title } else { &s.detail },
                files: s.files.iter().map(String::as_str).collect(),
            })
            .collect();
        let summary = steps::summarize(&summed);
        // Open unless closed here (the key marks a closed live group).
        // Open by default (or folded, per Settings); pressing the head flips it.
        let closed_key = format!("{key}-toggled");
        let open = crate::state::prefs::Prefs::get(cx).live_steps_folded == self.open.contains(&closed_key);
        let working = group
            .iter()
            .find(|s| matches!(s.status, WorkStepStatus::Running | WorkStepStatus::Waiting));
        let lead: Option<AnyElement> = working.map(|s| {
            if matches!(s.status, WorkStepStatus::Waiting) {
                icon(IconName::Clock, icon::XS).text_color(p.warning).into_any_element()
            } else {
                Loader::new(SharedString::from(format!("live-group-{key}")))
                    .size(icon::XS)
                    .into_any_element()
            }
        });
        let mut parts: Vec<AnyElement> = vec![div().truncate().child(steps::sentence(&summary)).into_any_element()];
        if summary.failed > 0 {
            parts.push(
                div()
                    .flex_none()
                    .text_color(p.danger)
                    .child(format!("· {}", tn("activity.errors", summary.failed as i64)))
                    .into_any_element(),
            );
        }
        if summary.refused > 0 {
            parts.push(
                div()
                    .flex_none()
                    .text_color(p.warning)
                    .child(format!("· {}", tn("activity.refused", summary.refused as i64)))
                    .into_any_element(),
            );
        }
        let view = cx.entity().downgrade();
        let toggle: step_tree::OnToggle = Rc::new(move |_, cx| {
            let _ = view.update(cx, |this, cx| this.toggle(closed_key.clone(), cx));
        });
        let head = step_tree::head(
            step_tree::Head {
                key: key.to_string(),
                open,
                rows: !group.is_empty(),
                leading: lead,
                parts,
                on_toggle: toggle,
            },
            window,
            cx,
        );
        let list = open.then(|| {
            let n = group.len();
            step_tree::list(
                group
                    .iter()
                    .enumerate()
                    .map(|(i, s)| {
                        let (tone, fact) = match s.status {
                            WorkStepStatus::Waiting => (
                                step_tree::Tone::Warning,
                                Some((t!("activity.waiting").into_owned(), p.warning)),
                            ),
                            WorkStepStatus::Error => (
                                step_tree::Tone::Danger,
                                Some((t!("activity.failedStep").into_owned(), p.danger)),
                            ),
                            WorkStepStatus::Refused => (
                                step_tree::Tone::Warning,
                                Some((t!("activity.refusedStep").into_owned(), p.warning)),
                            ),
                            _ => (
                                step_tree::Tone::Default,
                                s.duration_ms
                                    .filter(|ms| *ms >= 1000.)
                                    .map(|ms| (format::duration(ms, format::lang()), p.text_dim)),
                            ),
                        };
                        let mark: AnyElement = match s.status {
                            WorkStepStatus::Running => Loader::new(SharedString::from(format!("live-step-{}", s.id)))
                                .size(icon::XS)
                                .into_any_element(),
                            WorkStepStatus::Waiting => icon(IconName::Clock, icon::XS).into_any_element(),
                            _ => icon(glyph_of(&s.kind.to_string()), icon::XS).into_any_element(),
                        };
                        motion::enter(
                            div().child(
                                step_tree::Row {
                                    key: format!("live-{}", s.id),
                                    icon: mark,
                                    tone,
                                    title: s.title.clone(),
                                    facts: fact
                                        .map(|(f, c)| div().text_color(c).child(f).into_any_element())
                                        .into_iter()
                                        .collect(),
                                    hint: (!s.detail.is_empty() && s.detail != s.title).then(|| s.detail.clone()),
                                    last: i + 1 == n,
                                    open: false,
                                    on_toggle: None,
                                    body: Vec::new(),
                                }
                                .render(window, cx),
                            ),
                            SharedString::from(format!("live-step-in-{}", s.id)),
                            motion::ENTER_MS,
                            4.,
                        )
                        .into_any_element()
                    })
                    .collect(),
            )
        });
        div().flex().flex_col().child(head).children(list).into_any_element()
    }
}

/// A fold's head: a chevron that turns (spring) and what's inside, muted until hovered.
pub(super) fn step_line(
    key: &str,
    glyph: IconName,
    color: Rgba,
    title: String,
    fact: Option<String>,
    p: &Palette,
) -> Stateful<Div> {
    div()
        .id(SharedString::from(format!("step-line-{key}")))
        .flex()
        .items_center()
        .gap(px(space::X2))
        .min_h(px(tokens::CONTROL_H_SM))
        .text_sm()
        .text_color(color)
        .child(
            div()
                .flex_none()
                .w(px(icon::MD))
                .flex()
                .justify_center()
                .child(icon(glyph, icon::XS)),
        )
        .child(div().flex_1().min_w_0().truncate().child(title))
        .when_some(fact, |r, f| r.child(div().flex_none().text_color(p.text_dim).child(f)))
}

pub(super) fn code_box(text: String, color: Rgba, p: &Palette) -> Div {
    div()
        .px(px(space::X2_5))
        .py(px(space::X1_5))
        .rounded(px(tokens::RADIUS_CONTROL))
        .bg(p.bg_code)
        .font_family(MONO)
        .text_sm()
        .text_color(color)
        .child(text)
}

/// A step's glyph says what kind of work it was.
pub(super) fn glyph_of(tool: &str) -> IconName {
    match steps::kind_of(tool) {
        Some(steps::Kind::Search) => IconName::Search,
        Some(steps::Kind::Read) => IconName::FileText,
        Some(steps::Kind::Edit) => IconName::Pencil,
        Some(steps::Kind::Run) => IconName::SquareTerminal,
        Some(steps::Kind::Delegate) => IconName::Users,
        _ => IconName::Wrench,
    }
}

pub(super) fn status_of(s: &StepStatus) -> &'static str {
    match s {
        StepStatus::Error => "error",
        StepStatus::Refused => "refused",
        StepStatus::Ok => "ok",
    }
}
