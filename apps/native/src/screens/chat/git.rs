// The side panel's Pull request tab (apps/web/src/features/git.tsx › GitPanel): the way out of the chat's folder, one
// step at a time on a line of milestones: where the work is (its branch, or the chat's worktree, and what it came
// from) → commit what changed (a message written, or drafted by the chat's model; the files listed on demand) →
// push or publish (or "no remote") → open a pull request (drafted, then edited) or the one already open. The first
// step not done has the primary button; a later one keeps a quiet one. Under it the latest commits (accent dots: not
// pushed yet), then a new branch or the chat's own worktree (or leaving it). git's own words when it refuses. Read
// fresh each time the tab opens.
use super::*;

use gpui_kit::{
    base::input::Textarea,
    component::input::{Input, InputState},
};

use crate::net::types::{ChatsGitDraftSuccess, GitStatus};

#[derive(Default)]
pub struct Git {
    status: Option<GitStatus>,
    loading: bool,
    /// The step being done ("commit", "push", "pr", "draft", "branch", "worktree").
    busy: Option<&'static str>,
    error: Option<String>,
    done: Option<String>,
    show_files: bool,
    /// The pull request's form, once drafted; the new-branch form (true: as a worktree).
    pr_form: bool,
    new_branch: Option<bool>,
}

/// git's or gh's own words from a refusal (`{"message": …}`), else a generic line.
fn refusal(e: &crate::net::http::HttpError) -> String {
    match e {
        crate::net::http::HttpError::Status(_, body) => serde_json::from_str::<serde_json::Value>(body)
            .ok()
            .and_then(|v| v["message"].as_str().map(str::to_string))
            .filter(|m| !m.is_empty())
            .unwrap_or_else(|| t!("git.failed").into_owned()),
        _ => t!("git.failed").into_owned(),
    }
}

/// A step on the line: its dot (done ✓, now in the accent, later hollow), its title and hint, what it holds.
fn milestone(
    state: u8,
    title: AnyElement,
    hint: Option<String>,
    body: Option<AnyElement>,
    last: bool,
    p: &Palette,
) -> AnyElement {
    let dot = match state {
        0 => div()
            .size(px(16.))
            .rounded_full()
            .bg(p.success_faint)
            .flex()
            .items_center()
            .justify_center()
            .child(icon(IconName::Check, 10.).text_color(p.success)),
        1 => div()
            .size(px(16.))
            .rounded_full()
            .border_2()
            .border_color(p.accent)
            .bg(p.bg_canvas),
        _ => div()
            .size(px(16.))
            .rounded_full()
            .border_1()
            .border_color(p.border_strong)
            .bg(p.bg_canvas),
    };
    div()
        .relative()
        .flex()
        .gap(px(space::X3))
        .pb(px(if last { 0. } else { space::X4 }))
        .when(!last, |d| {
            d.child(
                div()
                    .absolute()
                    .top(px(18.))
                    .bottom_0()
                    .left(px(7.5))
                    .w(px(1.))
                    .bg(p.border),
            )
        })
        .child(div().flex_none().pt(px(2.)).child(dot))
        .child(
            div()
                .flex()
                .flex_col()
                .flex_1()
                .min_w_0()
                .gap(px(space::X2))
                .child(
                    div()
                        .flex()
                        .flex_col()
                        .child(
                            div()
                                .text_color(if state == 2 { p.text_muted } else { p.text })
                                .child(title),
                        )
                        .when_some(hint, |d, h| d.child(div().text_sm().text_color(p.text_muted).child(h))),
                )
                .children(body),
        )
        .into_any_element()
}

impl ChatScreen {
    pub(super) fn load_git(&mut self, cx: &mut Context<Self>) {
        if self.git.loading {
            return;
        }
        self.git.loading = true;
        let http = self.store.read(cx).http.clone();
        let path = format!("/api/chats/{}/git", self.chat_id);
        cx.spawn(async move |this, cx| {
            let got = runtime::spawn(async move { http.get::<GitStatus>(&path).await }).await;
            let _ = this.update(cx, |this, cx| {
                this.git.loading = false;
                if let Ok(Ok(s)) = got {
                    this.git.status = Some(s);
                }
                cx.notify();
            });
        })
        .detach();
    }

    /// Runs a git step on the engine; then reads the state again (and the files, which it changes).
    #[allow(clippy::too_many_arguments)]
    fn git_step(
        &mut self,
        step: &'static str,
        path: &'static str,
        body: serde_json::Value,
        ok: Option<String>,
        then: impl FnOnce(&mut ChatScreen, serde_json::Value, &mut Window, &mut Context<ChatScreen>) + 'static,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        self.git.busy = Some(step);
        self.git.error = None;
        self.git.done = None;
        cx.notify();
        let http = self.store.read(cx).http.clone();
        let url = format!("/api/chats/{}/{path}", self.chat_id);
        let delete = step == "leave";
        let task = runtime::spawn(async move {
            if delete {
                http.delete(&url).await.map(|_| serde_json::Value::Null)
            } else {
                http.post::<_, serde_json::Value>(&url, &body).await
            }
        });
        cx.spawn_in(window, async move |this, cx| {
            let done = task.await;
            let _ = this.update_in(cx, |this, window, cx| {
                this.git.busy = None;
                match done {
                    Ok(Ok(v)) => {
                        this.git.done = ok;
                        then(this, v, window, cx);
                    }
                    Ok(Err(e)) => this.git.error = Some(refusal(&e)),
                    Err(_) => this.git.error = Some(t!("git.failed").into_owned()),
                }
                this.load_git(cx);
                this.files.list = None; // the tree's marks change with a commit or a branch
                cx.notify();
            });
        })
        .detach();
    }

    pub(super) fn git_tab(&mut self, window: &mut Window, cx: &mut Context<Self>) -> AnyElement {
        let p = theme::palette(window);
        if self.git.status.is_none() {
            self.load_git(cx);
        }
        let Some(s) = self.git.status.clone() else {
            return div()
                .p(px(space::X4))
                .text_sm()
                .text_color(p.text_muted)
                .child(t!("common.checking").into_owned())
                .into_any_element();
        };
        if !s.repo {
            return div()
                .p(px(space::X4))
                .text_sm()
                .text_color(p.text_muted)
                .child(t!("git.notRepo").into_owned())
                .into_any_element();
        }
        let key = self.chat_id.clone();
        let message = window.use_keyed_state(SharedString::from(format!("git-msg-{key}")), cx, |window, cx| {
            let mut t = TextareaState::new(window, cx).placeholder(t!("git.messageHint").into_owned());
            t.set_auto_grow(3, 8, cx);
            t
        });
        let pr_title = window.use_keyed_state(SharedString::from(format!("git-pr-title-{key}")), cx, |window, cx| {
            InputState::new(window, cx).placeholder(t!("git.prTitle").into_owned())
        });
        let pr_body = window.use_keyed_state(SharedString::from(format!("git-pr-body-{key}")), cx, |window, cx| {
            let mut t = TextareaState::new(window, cx).placeholder(t!("git.prBody").into_owned());
            t.set_auto_grow(6, 14, cx);
            t
        });
        let branch_name = window.use_keyed_state(SharedString::from(format!("git-branch-{key}")), cx, |window, cx| {
            InputState::new(window, cx).placeholder(t!("git.branchHint").into_owned())
        });
        let worktree = self.store.read(cx).chat(&self.chat_id).and_then(|c| c.worktree.clone());
        let busy = self.git.busy;
        let has_files = !s.files.is_empty();
        let can_push = s.remote && s.branch.is_some() && (s.ahead > 0. || s.upstream.is_none());
        let can_pr = s.gh && s.remote && s.branch.is_some() && s.branch != s.base;
        let pr_pending = can_pr && s.pr.is_none();
        let first = if has_files {
            "commit"
        } else if can_push {
            "push"
        } else if pr_pending {
            "pr"
        } else {
            ""
        };
        let state = |step: &str, pending: bool| {
            if !pending {
                0
            } else if first == step {
                1
            } else {
                2
            }
        };
        let variant = |step: &str| {
            if first == step {
                Variant::Primary
            } else {
                Variant::Secondary
            }
        };
        let mut steps: Vec<(u8, AnyElement, Option<String>, Option<AnyElement>)> = Vec::new();

        // Where the work is.
        let mut where_: Vec<String> = Vec::new();
        if worktree.is_some() {
            where_.push(t!("git.inWorktree").into_owned());
        }
        if let Some(base) = s.base.as_ref().filter(|b| s.branch.as_ref() != Some(b)) {
            where_.push(t!("git.fromBase", base = base).into_owned());
        }
        if s.behind > 0. {
            where_.push(tn("git.behind", s.behind as i64));
        }
        steps.push((
            0,
            div()
                .font_family(MONO)
                .text_sm()
                .child(s.branch.clone().unwrap_or_else(|| t!("git.detached").into_owned()))
                .into_any_element(),
            (!where_.is_empty()).then(|| where_.join(" · ")),
            None,
        ));

        // Commit.
        let commit_body = has_files.then(|| {
            let (msg_draft, msg_commit) = (message.clone(), message.clone());
            let files = self.git.show_files.then(|| {
                div()
                    .flex()
                    .flex_col()
                    .max_h(px(288.))
                    .children(s.files.iter().map(|f| {
                        let (dir, name) = f.path.rsplit_once('/').unwrap_or(("", &f.path));
                        div()
                            .flex()
                            .items_center()
                            .gap(px(space::X2))
                            .h(px(tokens::CONTROL_H_SM))
                            .px(px(space::X2))
                            .text_sm()
                            .child(icon(IconName::File, icon::XS).text_color(p.text_muted))
                            .child(div().flex_none().child(name.to_string()))
                            .child(
                                div()
                                    .flex_1()
                                    .min_w_0()
                                    .truncate()
                                    .text_color(p.text_dim)
                                    .child(dir.to_string()),
                            )
                    }))
            });
            div()
                .flex()
                .flex_col()
                .gap(px(space::X2))
                .child(
                    div()
                        .flex()
                        .flex_col()
                        .rounded(px(tokens::RADIUS_CARD))
                        .border_1()
                        .border_color(p.border)
                        .bg(p.bg_surface)
                        .child(
                            div()
                                .px(px(space::X3))
                                .pt(px(space::X2))
                                .font_family(MONO)
                                .text_sm()
                                .child(Textarea::new(&message)),
                        )
                        .child(
                            div()
                                .flex()
                                .items_center()
                                .gap(px(space::X2))
                                .p(px(space::X1_5))
                                .child(
                                    Button::new(
                                        "git-write",
                                        if busy == Some("draft") {
                                            t!("git.writing")
                                        } else {
                                            t!("git.write")
                                        }
                                        .into_owned(),
                                    )
                                    .icon(IconName::Sparkles)
                                    .variant(Variant::Ghost)
                                    .size(Size::Sm)
                                    .disabled(busy.is_some())
                                    .on_click(cx.listener(
                                        move |this, _, window, cx| {
                                            let msg = msg_draft.clone();
                                            this.git_step(
                                                "draft",
                                                "git/draft",
                                                json!({ "kind": "commit" }),
                                                None,
                                                move |_, v, window, cx| {
                                                    let d: Option<ChatsGitDraftSuccess> =
                                                        serde_json::from_value(v).ok();
                                                    if let Some(d) = d {
                                                        let text = if d.body.is_empty() {
                                                            d.title
                                                        } else {
                                                            format!("{}\n\n{}", d.title, d.body)
                                                        };
                                                        msg.update(cx, |t, cx| t.set_value(text, window, cx));
                                                    }
                                                },
                                                window,
                                                cx,
                                            )
                                        },
                                    )),
                                )
                                .child(div().flex_1())
                                .child(
                                    Button::new("git-commit", tn("git.commit", s.files.len() as i64))
                                        .icon(IconName::Check)
                                        .variant(variant("commit"))
                                        .size(Size::Sm)
                                        .disabled(busy.is_some())
                                        .on_click(cx.listener(move |this, _, window, cx| {
                                            let text = msg_commit.read(cx).value().trim().to_string();
                                            if text.is_empty() {
                                                return;
                                            }
                                            let msg = msg_commit.clone();
                                            this.git_step(
                                                "commit",
                                                "git/commit",
                                                json!({ "message": text }),
                                                Some(t!("git.committed").into_owned()),
                                                move |_, _, window, cx| {
                                                    msg.update(cx, |t, cx| t.set_value(String::new(), window, cx));
                                                },
                                                window,
                                                cx,
                                            )
                                        })),
                                ),
                        ),
                )
                .child(
                    div().child(
                        Button::new(
                            "git-files",
                            if self.git.show_files {
                                t!("git.hideFiles").into_owned()
                            } else {
                                tn("git.showFiles", s.files.len() as i64)
                            },
                        )
                        .variant(Variant::Ghost)
                        .size(Size::Sm)
                        .on_click(cx.listener(|this, _, _, cx| {
                            this.git.show_files = !this.git.show_files;
                            cx.notify();
                        })),
                    ),
                )
                .children(files)
                .into_any_element()
        });
        steps.push((
            state("commit", has_files),
            div()
                .child(if has_files {
                    tn("git.changed", s.files.len() as i64)
                } else {
                    t!("git.clean").into_owned()
                })
                .into_any_element(),
            None,
            commit_body,
        ));

        // Push.
        if s.remote {
            let title = if !can_push {
                t!(
                    "git.upToDate",
                    upstream = s.upstream.clone().unwrap_or_else(|| "origin".into())
                )
                .into_owned()
            } else if s.upstream.is_some() {
                tn("git.ahead", s.ahead as i64)
            } else {
                t!("git.unpublished").into_owned()
            };
            let hint = (can_push && s.pr.is_some()).then(|| {
                t!(
                    "git.updatesPr",
                    number = s.pr.as_ref().map(|x| x.number as i64).unwrap_or(0)
                )
                .into_owned()
            });
            let body = can_push.then(|| {
                div()
                    .child(
                        Button::new(
                            "git-push",
                            if s.upstream.is_some() {
                                tn("git.push", s.ahead as i64)
                            } else {
                                t!("git.publish").into_owned()
                            },
                        )
                        .icon(IconName::ArrowUp)
                        .variant(variant("push"))
                        .size(Size::Sm)
                        .disabled(busy.is_some())
                        .on_click(cx.listener(|this, _, window, cx| {
                            this.git_step(
                                "push",
                                "git/push",
                                json!({}),
                                Some(t!("git.pushed").into_owned()),
                                |_, _, _, _| {},
                                window,
                                cx,
                            )
                        })),
                    )
                    .into_any_element()
            });
            steps.push((
                state("push", can_push),
                div().child(title).into_any_element(),
                hint,
                body,
            ));
        } else {
            steps.push((
                2,
                div().child(t!("git.noRemoteStep").into_owned()).into_any_element(),
                None,
                None,
            ));
        }

        // Pull request.
        if s.pr.is_some() || can_pr {
            let (title, hint, body): (String, Option<String>, AnyElement) = match &s.pr {
                Some(pr) => {
                    let url = pr.url.clone();
                    (
                        pr.title.clone(),
                        Some(t!("git.prOpen", number = pr.number as i64, state = pr.state.clone()).into_owned()),
                        div()
                            .child(
                                Button::new("git-pr-open", t!("git.openOnGithub").into_owned())
                                    .icon(IconName::ExternalLink)
                                    .variant(Variant::Ghost)
                                    .size(Size::Sm)
                                    .on_click(move |_, _, cx| cx.open_url(&url)),
                            )
                            .into_any_element(),
                    )
                }
                None if self.git.pr_form => {
                    let (t_in, b_in) = (pr_title.clone(), pr_body.clone());
                    (
                        t!("git.noPr").into_owned(),
                        s.base.as_ref().map(|b| t!("git.prInto", base = b).into_owned()),
                        div()
                            .flex()
                            .flex_col()
                            .gap(px(space::X2))
                            .child(
                                div()
                                    .px(px(space::X2_5))
                                    .h(px(tokens::CONTROL_H))
                                    .flex()
                                    .items_center()
                                    .rounded(px(tokens::RADIUS_CONTROL))
                                    .border_1()
                                    .border_color(p.border)
                                    .bg(p.bg_field)
                                    .child(div().flex_1().child(Input::new(&pr_title).appearance(false))),
                            )
                            .child(
                                div()
                                    .px(px(space::X2_5))
                                    .py(px(space::X2))
                                    .rounded(px(tokens::RADIUS_CONTROL))
                                    .border_1()
                                    .border_color(p.border)
                                    .bg(p.bg_field)
                                    .text_sm()
                                    .child(Textarea::new(&pr_body)),
                            )
                            .child(
                                div()
                                    .flex()
                                    .justify_end()
                                    .gap(px(space::X2))
                                    .child(
                                        Button::new("git-pr-cancel", t!("common.cancel").into_owned())
                                            .variant(Variant::Ghost)
                                            .size(Size::Sm)
                                            .on_click(cx.listener(|this, _, _, cx| {
                                                this.git.pr_form = false;
                                                cx.notify();
                                            })),
                                    )
                                    .child(
                                        Button::new("git-pr-create", t!("git.openPr").into_owned())
                                            .variant(Variant::Primary)
                                            .size(Size::Sm)
                                            .disabled(busy.is_some())
                                            .on_click(cx.listener(move |this, _, window, cx| {
                                                let title = t_in.read(cx).value().trim().to_string();
                                                let body = b_in.read(cx).value().to_string();
                                                if title.is_empty() {
                                                    return;
                                                }
                                                this.git_step(
                                                    "pr",
                                                    "git/pr",
                                                    json!({ "title": title, "body": body }),
                                                    Some(t!("git.prCreated").into_owned()),
                                                    |this, _, _, _| {
                                                        this.git.pr_form = false;
                                                    },
                                                    window,
                                                    cx,
                                                )
                                            })),
                                    ),
                            )
                            .into_any_element(),
                    )
                }
                None => {
                    let (t_in, b_in) = (pr_title.clone(), pr_body.clone());
                    (
                        t!("git.noPr").into_owned(),
                        s.base.as_ref().map(|b| t!("git.prInto", base = b).into_owned()),
                        div()
                            .child(
                                Button::new(
                                    "git-pr-draft",
                                    if busy == Some("draft") {
                                        t!("git.writing")
                                    } else {
                                        t!("git.createPr")
                                    }
                                    .into_owned(),
                                )
                                .icon(IconName::GitPullRequest)
                                .variant(variant("pr"))
                                .size(Size::Sm)
                                .disabled(busy.is_some())
                                .on_click(cx.listener(move |this, _, window, cx| {
                                    let (t_in, b_in) = (t_in.clone(), b_in.clone());
                                    this.git_step(
                                        "draft",
                                        "git/draft",
                                        json!({ "kind": "pr" }),
                                        None,
                                        move |this, v, window, cx| {
                                            if let Ok(d) = serde_json::from_value::<ChatsGitDraftSuccess>(v) {
                                                t_in.update(cx, |s, cx| s.set_value(d.title, window, cx));
                                                b_in.update(cx, |s, cx| s.set_value(d.body, window, cx));
                                            }
                                            this.git.pr_form = true;
                                        },
                                        window,
                                        cx,
                                    )
                                })),
                            )
                            .into_any_element(),
                    )
                }
            };
            steps.push((
                state("pr", pr_pending),
                div().child(title).into_any_element(),
                hint,
                Some(body),
            ));
        }

        let count = steps.len();
        let line: Vec<AnyElement> = steps
            .into_iter()
            .enumerate()
            .map(|(i, (st, title, hint, body))| milestone(st, title, hint, body, i + 1 == count, p))
            .collect();
        let status = self
            .git
            .error
            .clone()
            .map(|e| (e, true))
            .or(self.git.done.clone().map(|d| (d, false)));
        let part = |title: String| div().text_sm().text_color(p.text_muted).child(title);
        let mut column = div().flex().flex_col().gap(px(space::X6)).p(px(space::X4)).child(
            div()
                .flex()
                .flex_col()
                .gap(px(space::X3))
                .child(part(t!("git.ship").into_owned()))
                .child(div().flex().flex_col().children(line))
                .when_some(status, |d, (text, error)| {
                    d.child(
                        div()
                            .px(px(space::X3))
                            .py(px(space::X2))
                            .rounded(px(tokens::RADIUS_CONTROL))
                            .text_sm()
                            .map(|d| {
                                if error {
                                    d.bg(p.danger_soft).text_color(p.danger).font_family(MONO)
                                } else {
                                    d.bg(p.success_faint).text_color(p.success)
                                }
                            })
                            .child(text),
                    )
                }),
        );
        if !s.commits.is_empty() {
            let now = format::now_ms();
            column = column.child(
                div()
                    .flex()
                    .flex_col()
                    .gap(px(space::X2_5))
                    .child(part(t!("git.commits").into_owned()))
                    .child(div().flex().flex_col().children(s.commits.iter().map(|c| {
                        div()
                            .flex()
                            .items_center()
                            .gap(px(space::X3))
                            .h(px(32.))
                            .text_sm()
                            .child(div().flex_none().size(px(8.)).rounded_full().map(|d| {
                                if c.pushed {
                                    d.border_1().border_color(p.border_strong)
                                } else {
                                    d.bg(p.accent)
                                }
                            }))
                            .child(
                                div()
                                    .flex_1()
                                    .min_w_0()
                                    .truncate()
                                    .text_color(p.text_secondary)
                                    .child(c.subject.clone()),
                            )
                            .child(
                                div()
                                    .flex_none()
                                    .font_family(MONO)
                                    .text_xs()
                                    .text_color(p.text_dim)
                                    .child(c.sha.clone()),
                            )
                            .child(
                                div()
                                    .flex_none()
                                    .w(px(48.))
                                    .text_right()
                                    .text_xs()
                                    .text_color(p.text_dim)
                                    .child(format::age(c.at, now, format::lang())),
                            )
                    }))),
            );
        }
        // A new branch, the chat's own worktree, or leaving it.
        let mut more = div().flex().flex_col().gap(px(space::X2));
        if let Some(path) = worktree.clone() {
            more = more.child(
                div()
                    .flex()
                    .items_center()
                    .gap(px(space::X2))
                    .px(px(space::X3))
                    .py(px(space::X2))
                    .rounded(px(tokens::RADIUS_CARD))
                    .border_1()
                    .border_color(p.border)
                    .child(icon(IconName::Folder, icon::SM).text_color(p.text_muted))
                    .child(
                        div()
                            .flex()
                            .flex_col()
                            .flex_1()
                            .min_w_0()
                            .child(div().text_sm().child(t!("git.inWorktree").into_owned()))
                            .child(
                                div()
                                    .truncate()
                                    .font_family(MONO)
                                    .text_xs()
                                    .text_color(p.text_muted)
                                    .child(path),
                            ),
                    )
                    .child(
                        Button::new("git-leave", t!("git.leaveWorktree").into_owned())
                            .variant(Variant::Ghost)
                            .size(Size::Sm)
                            .disabled(busy.is_some())
                            .on_click(cx.listener(|this, _, window, cx| {
                                this.git_step(
                                    "leave",
                                    "worktree",
                                    json!({}),
                                    Some(t!("git.leftWorktree").into_owned()),
                                    |this, _, _, cx| {
                                        this.store.update(cx, |s, cx| s.reload_chats(cx));
                                    },
                                    window,
                                    cx,
                                )
                            })),
                    ),
            );
        }
        more = match self.git.new_branch {
            None => more.child(
                div()
                    .flex()
                    .flex_wrap()
                    .gap(px(space::X1))
                    .child(
                        Button::new("git-new-branch", t!("git.newBranch").into_owned())
                            .icon(IconName::GitBranch)
                            .variant(Variant::Ghost)
                            .size(Size::Sm)
                            .on_click(cx.listener(|this, _, _, cx| {
                                this.git.new_branch = Some(false);
                                cx.notify();
                            })),
                    )
                    .when(worktree.is_none(), |d| {
                        d.child(
                            Button::new("git-new-worktree", t!("git.newWorktree").into_owned())
                                .icon(IconName::Folder)
                                .variant(Variant::Ghost)
                                .size(Size::Sm)
                                .on_click(cx.listener(|this, _, _, cx| {
                                    this.git.new_branch = Some(true);
                                    cx.notify();
                                })),
                        )
                    }),
            ),
            Some(as_worktree) => {
                let name = branch_name.clone();
                more.when(as_worktree, |d| {
                    d.child(
                        div()
                            .text_sm()
                            .text_color(p.text_muted)
                            .child(t!("git.worktreeHint").into_owned()),
                    )
                })
                .child(
                    div()
                        .px(px(space::X2_5))
                        .h(px(tokens::CONTROL_H_SM))
                        .flex()
                        .items_center()
                        .rounded(px(tokens::RADIUS_CONTROL_SM))
                        .border_1()
                        .border_color(p.border)
                        .bg(p.bg_field)
                        .font_family(MONO)
                        .text_sm()
                        .child(div().flex_1().child(Input::new(&branch_name).appearance(false))),
                )
                .child(
                    div()
                        .flex()
                        .justify_end()
                        .gap(px(space::X2))
                        .child(
                            Button::new("git-branch-cancel", t!("common.cancel").into_owned())
                                .variant(Variant::Ghost)
                                .size(Size::Sm)
                                .on_click(cx.listener(|this, _, _, cx| {
                                    this.git.new_branch = None;
                                    cx.notify();
                                })),
                        )
                        .child(
                            Button::new(
                                "git-branch-go",
                                if as_worktree {
                                    t!("git.createWorktree")
                                } else {
                                    t!("git.switch")
                                }
                                .into_owned(),
                            )
                            .variant(Variant::Primary)
                            .size(Size::Sm)
                            .disabled(busy.is_some())
                            .on_click(cx.listener(move |this, _, window, cx| {
                                let typed = name.read(cx).value().trim().to_string();
                                let reset = |this: &mut ChatScreen,
                                             _: serde_json::Value,
                                             _: &mut Window,
                                             cx: &mut Context<ChatScreen>| {
                                    this.git.new_branch = None;
                                    this.store.update(cx, |s, cx| s.reload_chats(cx));
                                };
                                if as_worktree {
                                    let body = if typed.is_empty() {
                                        json!({})
                                    } else {
                                        json!({ "branch": typed })
                                    };
                                    this.git_step(
                                        "worktree",
                                        "worktree",
                                        body,
                                        Some(t!("git.inWorktreeNow").into_owned()),
                                        reset,
                                        window,
                                        cx,
                                    )
                                } else if !typed.is_empty() {
                                    this.git_step(
                                        "branch",
                                        "git/branch",
                                        json!({ "name": typed }),
                                        None,
                                        reset,
                                        window,
                                        cx,
                                    )
                                }
                            })),
                        ),
                )
            }
        };
        column.child(more).into_any_element()
    }
}
