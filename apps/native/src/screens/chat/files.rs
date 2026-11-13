// The side panel's Files tab (apps/web/src/features/workspace.tsx › FilesTab): the project's files as a tree, folders
// first, what the chat's turns changed marked (A/M/D, and on the folders holding it), the top folders with changes
// open at first; a search keeps what matches (and the folders on its way, open). A file opens as a tab after the
// tree's own, read-only with line numbers (or why it can't show, with Open in app). A row's right-click: Open, Open
// in app, Show changes, Reveal, Add to chat, Copy path.
// ponytail: creating, renaming, moving and deleting files (the web's fs ops with Undo) come next.
use super::*;

use crate::net::types::{ChatsReadFileSuccess, WorkspaceFile, WorkspaceFileStatus as Status};

/// One node of the tree.
#[derive(Clone, Debug, PartialEq)]
pub struct Node {
    pub name: String,
    pub path: String,
    /// Its own change, or (a folder) that something inside changed.
    pub status: Option<Status>,
    pub children: Option<Vec<Node>>,
}

/// The files as a tree, folders first then by name.
pub fn tree_of(files: &[WorkspaceFile]) -> Vec<Node> {
    fn insert(level: &mut Vec<Node>, parts: &[&str], prefix: String, status: Option<Status>) {
        let Some((name, rest)) = parts.split_first() else {
            return;
        };
        let path = if prefix.is_empty() {
            name.to_string()
        } else {
            format!("{prefix}/{name}")
        };
        let leaf = rest.is_empty();
        let at = match level
            .iter()
            .position(|n| n.name == *name && n.children.is_some() != leaf)
        {
            Some(i) => i,
            None => {
                level.push(Node {
                    name: name.to_string(),
                    path: path.clone(),
                    status: if leaf { status } else { None },
                    children: (!leaf).then(Vec::new),
                });
                level.len() - 1
            }
        };
        if !leaf {
            let node = &mut level[at];
            if status.is_some() && node.status.is_none() {
                node.status = Some(Status::Modified);
            }
            insert(node.children.as_mut().expect("a folder"), rest, path, status);
        }
    }
    fn sort(level: &mut [Node]) {
        level.sort_by(|a, b| {
            b.children
                .is_some()
                .cmp(&a.children.is_some())
                .then_with(|| a.name.cmp(&b.name))
        });
        for n in level.iter_mut() {
            if let Some(c) = &mut n.children {
                sort(c);
            }
        }
    }
    let mut top = Vec::new();
    for f in files {
        let parts: Vec<&str> = f.path.split('/').filter(|s| !s.is_empty()).collect();
        insert(&mut top, &parts, String::new(), f.status);
    }
    sort(&mut top);
    top
}

/// What a search keeps: matching files and folders (a matching folder keeps all it holds), and the folders on the
/// way to them.
pub fn matching(nodes: &[Node], q: &str) -> Vec<Node> {
    nodes
        .iter()
        .filter_map(|n| {
            if n.name.to_lowercase().contains(q) {
                return Some(n.clone());
            }
            let kids = matching(n.children.as_deref()?, q);
            (!kids.is_empty()).then(|| Node {
                children: Some(kids),
                ..n.clone()
            })
        })
        .collect()
}

/// The Files tab's state.
#[derive(Default)]
pub struct Files {
    pub(super) list: Option<Rc<Vec<Node>>>,
    loading: bool,
    /// Open folders (None: not chosen yet, so the top folders with changes open).
    expanded: Option<HashSet<String>>,
    /// Open files, and the one shown (None: the tree).
    open: Vec<String>,
    shown: Option<String>,
    contents: HashMap<String, Option<Option<Rc<Vec<String>>>>>,
}

fn status_mark(status: Option<Status>, p: &Palette) -> Option<Div> {
    let (letter, color) = match status? {
        Status::Added => ("A", p.success),
        Status::Modified => ("M", p.warning),
        Status::Deleted => ("D", p.danger),
    };
    Some(
        div()
            .flex_none()
            .text_xs()
            .font_weight(FontWeight::SEMIBOLD)
            .text_color(color)
            .child(letter),
    )
}

impl ChatScreen {
    fn project_id(&self, cx: &App) -> Option<String> {
        self.store
            .read(cx)
            .chat(&self.chat_id)
            .and_then(|c| c.project_id.clone())
    }

    /// Reads the project's file list (again).
    pub(super) fn load_files(&mut self, cx: &mut Context<Self>) {
        let Some(project) = self.project_id(cx) else { return };
        if self.files.loading {
            return;
        }
        self.files.loading = true;
        let http = self.store.read(cx).http.clone();
        let path = format!("/api/projects/{project}/files?chatId={}", self.chat_id);
        cx.spawn(async move |this, cx| {
            let got = runtime::spawn(async move { http.get::<Vec<WorkspaceFile>>(&path).await }).await;
            let _ = this.update(cx, |this, cx| {
                this.files.loading = false;
                match got {
                    Ok(Ok(files)) => this.files.list = Some(Rc::new(tree_of(&files))),
                    Ok(Err(e)) => eprintln!("files: {e}"),
                    Err(_) => {}
                }
                cx.notify();
            });
        })
        .detach();
    }

    fn open_file(&mut self, path: String, cx: &mut Context<Self>) {
        if !self.files.open.contains(&path) {
            self.files.open.push(path.clone());
        }
        self.files.shown = Some(path.clone());
        if !self.files.contents.contains_key(&path) {
            self.files.contents.insert(path.clone(), None);
            let http = self.store.read(cx).http.clone();
            let url = format!(
                "/api/chats/{}/file?path={}",
                self.chat_id,
                crate::net::http::uri_encode(&path)
            );
            cx.spawn(async move |this, cx| {
                let got = runtime::spawn(async move { http.get::<ChatsReadFileSuccess>(&url).await }).await;
                let text = match got {
                    Ok(Ok(f)) => f
                        .contents
                        .map(|c| Rc::new(c.lines().map(str::to_string).collect::<Vec<_>>())),
                    _ => None,
                };
                let _ = this.update(cx, |this, cx| {
                    this.files.contents.insert(path, Some(text));
                    cx.notify();
                });
            })
            .detach();
        }
        cx.notify();
    }

    fn close_file(&mut self, path: &str, cx: &mut Context<Self>) {
        let at = self.files.open.iter().position(|p| p == path).unwrap_or(0);
        self.files.open.retain(|p| p != path);
        if self.files.shown.as_deref() == Some(path) {
            self.files.shown = self
                .files
                .open
                .get(at.min(self.files.open.len().saturating_sub(1)))
                .cloned();
        }
        cx.notify();
    }

    /// The engine's open / reveal on a path of the chat's folder.
    fn fs_op(&self, op: &'static str, path: String, cx: &mut Context<Self>) {
        let http = self.store.read(cx).http.clone();
        let url = format!("/api/chats/{}/fs", self.chat_id);
        runtime::spawn(async move {
            if let Err(e) = http
                .post::<_, serde_json::Value>(&url, &json!({ "op": op, "path": path }))
                .await
            {
                eprintln!("fs {op}: {e}");
            }
        });
    }

    /// Shows the newest turn that changed a file, narrowed to it.
    fn show_changes_of(&mut self, path: String, cx: &mut Context<Self>) {
        let turn = self
            .log
            .messages
            .iter()
            .rev()
            .find(|m| m.changes.iter().any(|c| c.path == path))
            .and_then(|m| m.turn_id.clone());
        if let Some(turn) = turn {
            self.view_turn(turn.clone(), cx);
            if let Some(side) = &mut self.side {
                side.focus = Some((turn, Some(path)));
            }
        }
    }

    pub(super) fn files_tab(&mut self, window: &mut Window, cx: &mut Context<Self>) -> AnyElement {
        let p = theme::palette(window);
        if self.files.list.is_none() {
            self.load_files(cx);
        }
        // The tree's tab, then each open file.
        let shown = self.files.shown.clone();
        let mut strip: Vec<AnyElement> = vec![
            div()
                .id("files-tree-tab")
                .flex_none()
                .px(px(space::X2_5))
                .h(px(tokens::CONTROL_H_SM))
                .flex()
                .items_center()
                .rounded(px(tokens::RADIUS_CONTROL_SM))
                .text_sm()
                .map(|d| {
                    if shown.is_none() {
                        d.bg(p.bg_control).text_color(p.text)
                    } else {
                        d.text_color(p.text_muted)
                    }
                })
                .hover(|s| s.bg(p.bg_control))
                .child(t!("workspace.files").into_owned())
                .on_click(cx.listener(|this, _, _, cx| {
                    this.files.shown = None;
                    cx.notify();
                }))
                .into_any_element(),
        ];
        for path in self.files.open.clone() {
            let name = path.rsplit('/').next().unwrap_or(&path).to_string();
            let selected = shown.as_deref() == Some(path.as_str());
            let (show, close) = (path.clone(), path.clone());
            strip.push(
                div()
                    .id(SharedString::from(format!("files-tab-{path}")))
                    .flex()
                    .flex_none()
                    .items_center()
                    .gap(px(space::X1))
                    .pl(px(space::X2_5))
                    .pr(px(space::X1))
                    .h(px(tokens::CONTROL_H_SM))
                    .rounded(px(tokens::RADIUS_CONTROL_SM))
                    .text_sm()
                    .map(|d| {
                        if selected {
                            d.bg(p.bg_control).text_color(p.text)
                        } else {
                            d.text_color(p.text_muted)
                        }
                    })
                    .hover(|s| s.bg(p.bg_control))
                    .child(div().max_w(px(160.)).truncate().child(name.clone()))
                    .child(
                        Button::icon_only(
                            SharedString::from(format!("files-close-{path}")),
                            IconName::X,
                            t!("explorer.closeFile", name = name).into_owned(),
                        )
                        .size(Size::Xs)
                        .on_click(cx.listener(move |this, _, _, cx| this.close_file(&close, cx))),
                    )
                    .on_click(cx.listener(move |this, _, _, cx| {
                        this.files.shown = Some(show.clone());
                        cx.notify();
                    }))
                    .into_any_element(),
            );
        }
        let body = match shown {
            Some(path) => self.file_view(&path, window, cx),
            None => self.tree_view(window, cx),
        };
        div()
            .flex()
            .flex_col()
            .size_full()
            .child(
                div()
                    .id("files-strip")
                    .flex()
                    .flex_none()
                    .gap(px(space::X1))
                    .px(px(space::X3))
                    .py(px(space::X1_5))
                    .overflow_x_scroll()
                    .border_b_1()
                    .border_color(p.border)
                    .children(strip),
            )
            .child(div().flex_1().min_h_0().child(body))
            .into_any_element()
    }

    fn tree_view(&mut self, window: &mut Window, cx: &mut Context<Self>) -> AnyElement {
        let p = theme::palette(window);
        let Some(list) = self.files.list.clone() else {
            return div()
                .flex()
                .justify_center()
                .py(px(space::X10))
                .child(Loader::new("files-loading").size(icon::MD))
                .into_any_element();
        };
        let query = window.use_keyed_state(
            SharedString::from(format!("files-search-{}", self.chat_id)),
            cx,
            |window, cx| {
                gpui_kit::component::input::InputState::new(window, cx).placeholder(t!("explorer.search").into_owned())
            },
        );
        let q = query.read(cx).value().trim().to_lowercase();
        // At first, the top folders that hold changes are open.
        let expanded = self
            .files
            .expanded
            .get_or_insert_with(|| {
                list.iter()
                    .filter(|n| n.children.is_some() && n.status.is_some())
                    .map(|n| n.path.clone())
                    .collect()
            })
            .clone();
        let nodes = if q.is_empty() {
            list.as_ref().clone()
        } else {
            matching(&list, &q)
        };
        let mut rows: Vec<AnyElement> = Vec::new();
        self.tree_rows(&nodes, 0, &expanded, !q.is_empty(), &mut rows, window, cx);
        if rows.is_empty() {
            rows.push(
                div()
                    .px(px(space::X3))
                    .py(px(space::X2))
                    .text_sm()
                    .text_color(p.text_muted)
                    .child(t!("explorer.noMatch").into_owned())
                    .into_any_element(),
            );
        }
        div()
            .flex()
            .flex_col()
            .size_full()
            .child(
                div()
                    .flex()
                    .flex_none()
                    .items_center()
                    .gap(px(space::X2))
                    .px(px(space::X3))
                    .py(px(space::X2))
                    .child(
                        div()
                            .flex()
                            .flex_1()
                            .items_center()
                            .gap(px(space::X2))
                            .h(px(tokens::CONTROL_H_SM))
                            .px(px(space::X2_5))
                            .rounded(px(tokens::RADIUS_CONTROL_SM))
                            .bg(p.bg_field)
                            .text_sm()
                            .child(icon(IconName::Search, icon::SM).text_color(p.text_muted))
                            .child(
                                div()
                                    .flex_1()
                                    .child(gpui_kit::component::input::Input::new(&query).appearance(false)),
                            ),
                    )
                    .child(
                        Button::icon_only(
                            "files-collapse",
                            IconName::Minimize2,
                            t!("explorer.collapse").into_owned(),
                        )
                        .size(Size::Xs)
                        .on_click(cx.listener(|this, _, _, cx| {
                            this.files.expanded = Some(HashSet::new());
                            cx.notify();
                        })),
                    )
                    .child(
                        Button::icon_only("files-reload", IconName::RefreshCw, t!("common.reload").into_owned())
                            .size(Size::Xs)
                            .on_click(cx.listener(|this, _, _, cx| this.load_files(cx))),
                    ),
            )
            .child(
                div()
                    .id("files-tree")
                    .flex_1()
                    .min_h_0()
                    .overflow_y_scroll()
                    .px(px(space::X1_5))
                    .pb(px(space::X3))
                    .children(rows),
            )
            .into_any_element()
    }

    #[allow(clippy::too_many_arguments)]
    fn tree_rows(
        &mut self,
        nodes: &[Node],
        depth: usize,
        expanded: &HashSet<String>,
        searching: bool,
        out: &mut Vec<AnyElement>,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        let p = theme::palette(window);
        for n in nodes {
            let folder = n.children.is_some();
            let open = folder && (searching || expanded.contains(&n.path));
            let path = n.path.clone();
            let id = ElementId::from(SharedString::from(format!("file-row-{}", n.path)));
            let row = div()
                .id(id.clone())
                .flex()
                .items_center()
                .gap(px(space::X1_5))
                .h(px(tokens::CONTROL_H_SM))
                .pl(px(space::X2 + depth as f32 * 14.))
                .pr(px(space::X2))
                .rounded(px(tokens::RADIUS_CONTROL_SM))
                .text_sm()
                .hover(|s| s.bg(p.bg_control))
                .child(div().flex_none().w(px(icon::XS)).when(folder, |d| {
                    d.child(
                        icon(
                            if open {
                                IconName::ChevronDown
                            } else {
                                IconName::ChevronRight
                            },
                            icon::XS,
                        )
                        .text_color(p.text_muted),
                    )
                }))
                .child(icon(if folder { IconName::Folder } else { IconName::File }, icon::XS).text_color(p.text_muted))
                .child(
                    div()
                        .flex_1()
                        .min_w_0()
                        .truncate()
                        .text_color(if n.status.is_some() { p.text } else { p.text_secondary })
                        .child(n.name.clone()),
                )
                .children(status_mark(n.status, p))
                .on_click(cx.listener(move |this, _, _, cx| {
                    if folder {
                        let set = this.files.expanded.get_or_insert_with(HashSet::new);
                        if !set.remove(&path) {
                            set.insert(path.clone());
                        }
                        cx.notify();
                    } else {
                        this.open_file(path.clone(), cx);
                    }
                }));
            let items = self.file_menu(&n.path, folder, n.status.is_some(), cx);
            out.push(crate::ui::menu::on_right_click(&id, row, items, window, cx));
            if open && let Some(kids) = &n.children {
                self.tree_rows(kids, depth + 1, expanded, searching, out, window, cx);
            }
        }
    }

    fn file_menu(&self, path: &str, folder: bool, changed: bool, cx: &mut Context<Self>) -> crate::ui::menu::Items {
        let (path, view) = (path.to_string(), cx.entity().downgrade());
        Rc::new(move || {
            let mut m = crate::ui::menu::Menu::default();
            let act = |f: fn(&mut ChatScreen, String, &mut Context<ChatScreen>)| {
                let (view, path) = (view.clone(), path.clone());
                move |_: &mut Window, cx: &mut App| {
                    let _ = view.update(cx, |this, cx| f(this, path.clone(), cx));
                }
            };
            if !folder {
                m = m
                    .item(
                        t!("explorer.open").into_owned(),
                        act(|this, p, cx| this.open_file(p, cx)),
                    )
                    .icon(IconName::File);
            }
            m = m.item(
                t!("explorer.openInApp").into_owned(),
                act(|this, p, cx| this.fs_op("open", p, cx)),
            );
            if changed && !folder {
                m = m.item(
                    t!("explorer.showChanges").into_owned(),
                    act(|this, p, cx| this.show_changes_of(p, cx)),
                );
            }
            m = m.item(
                t!("explorer.reveal").into_owned(),
                act(|this, p, cx| this.fs_op("reveal", p, cx)),
            );
            m = m
                .separator()
                .item(
                    t!("workspace.addToChat").into_owned(),
                    act(|this, p, cx| this.add_to_chat(format!("`{p}`"), cx)),
                )
                .item(
                    t!("explorer.copyRelative").into_owned(),
                    act(|_, p, cx| cx.write_to_clipboard(ClipboardItem::new_string(p))),
                );
            m.build()
        })
    }

    /// Text for the message box (a path, a terminal selection), as a paragraph of its own.
    pub(super) fn add_to_chat(&mut self, text: String, cx: &mut Context<Self>) {
        self.composer.update(cx, |c, cx| c.append(text, cx));
    }

    fn file_view(&mut self, path: &str, window: &mut Window, cx: &mut Context<Self>) -> AnyElement {
        let p = theme::palette(window);
        let lines = self.files.contents.get(path).cloned().flatten();
        let open_path = path.to_string();
        let head = div()
            .flex()
            .flex_none()
            .items_center()
            .gap(px(space::X2))
            .px(px(space::X3))
            .py(px(space::X1_5))
            .border_b_1()
            .border_color(p.border)
            .child(
                div()
                    .flex_1()
                    .min_w_0()
                    .truncate()
                    .font_family(MONO)
                    .text_sm()
                    .text_color(p.text_secondary)
                    .child(path.to_string()),
            )
            .child(
                Button::new("file-open-app", t!("explorer.openInApp").into_owned())
                    .variant(Variant::Ghost)
                    .size(Size::Xs)
                    .on_click(cx.listener(move |this, _, _, cx| this.fs_op("open", open_path.clone(), cx))),
            );
        let body = match self.files.contents.get(path) {
            None | Some(None) => div()
                .flex()
                .justify_center()
                .py(px(space::X10))
                .child(Loader::new("file-loading").size(icon::MD))
                .into_any_element(),
            Some(Some(None)) => div()
                .p(px(space::X4))
                .text_sm()
                .text_color(p.text_muted)
                .child(t!("explorer.cantShow").into_owned())
                .into_any_element(),
            Some(Some(Some(_))) => {
                let lines = lines.flatten().unwrap_or_default();
                let count = lines.len();
                let width = (count.max(1).ilog10() as f32 + 1.) * 8. + 16.;
                uniform_list(
                    SharedString::from(format!("file-lines-{path}")),
                    count,
                    move |range, window, _| {
                        let p = theme::palette(window);
                        range
                            .map(|i| {
                                div()
                                    .flex()
                                    .h(px(18.))
                                    .font_family(MONO)
                                    .text_size(px(12.))
                                    .line_height(px(18.))
                                    .child(
                                        div()
                                            .flex_none()
                                            .w(px(width))
                                            .pr(px(space::X2))
                                            .text_right()
                                            .text_color(p.text_dim)
                                            .child((i + 1).to_string()),
                                    )
                                    .child(
                                        div()
                                            .flex_1()
                                            .min_w_0()
                                            .truncate()
                                            .text_color(p.text_secondary)
                                            .child(lines[i].clone()),
                                    )
                            })
                            .collect()
                    },
                )
                .size_full()
                .bg(p.bg_code)
                .into_any_element()
            }
        };
        div()
            .flex()
            .flex_col()
            .size_full()
            .child(head)
            .child(div().flex_1().min_h_0().child(body))
            .into_any_element()
    }
}

#[cfg(test)]
mod tests {
    use super::{matching, tree_of};
    use crate::net::types::{WorkspaceFile, WorkspaceFileStatus as S};

    fn f(path: &str, status: Option<S>) -> WorkspaceFile {
        WorkspaceFile {
            path: path.into(),
            status,
        }
    }

    #[test]
    fn files_become_a_tree_with_folders_first_and_changes_marked_up() {
        let tree = tree_of(&[
            f("b.ts", None),
            f("src/a.ts", Some(S::Added)),
            f("src/lib/x.ts", None),
            f("a.md", None),
        ]);
        let names: Vec<&str> = tree.iter().map(|n| n.name.as_str()).collect();
        assert_eq!(names, ["src", "a.md", "b.ts"]);
        assert_eq!(tree[0].status, Some(S::Modified)); // holds a change
        let src: Vec<&str> = tree[0]
            .children
            .as_ref()
            .unwrap()
            .iter()
            .map(|n| n.path.as_str())
            .collect();
        assert_eq!(src, ["src/lib", "src/a.ts"]);
        let found = matching(&tree, "x.ts");
        assert_eq!(
            found[0].children.as_ref().unwrap()[0].children.as_ref().unwrap()[0].path,
            "src/lib/x.ts"
        );
    }
}
