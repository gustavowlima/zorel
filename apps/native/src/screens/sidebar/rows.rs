// The sidebar's rows: a chat, a group of them (the first few, then More), and a section's head.
use super::*;

impl Sidebar {
    pub(super) fn chat_row(
        &self,
        chat: &Chat,
        status: Option<&ChatStatus>,
        store: &Store,
        window: &Window,
        cx: &Context<Self>,
    ) -> NavRow {
        let p = theme::palette(window);
        let state = face_state(status);
        // Always the face of the agent who worked last (the status's, else the lead); a chat that never had one
        // keeps the default mark.
        let last = status
            .and_then(|s| s.agent_id.as_deref())
            .or(chat.agent_ids.first().map(String::as_str));
        let leading: AnyElement = match last {
            Some(agent) => AgentFace::new(
                SharedString::from(format!("side-face-{}", chat.id)),
                store.tone(Some(agent)),
            )
            .size(20.)
            .state(state)
            .into_any_element(),
            None => icon(IconName::MessageCircle, icon::MD)
                .text_color(p.text_muted)
                .into_any_element(),
        };
        let detail = status.map(|s| status_label(s, store)).filter(|d| !d.is_empty());
        let tone = match state {
            FaceState::Waiting => Some(p.warning),
            FaceState::Failed => Some(p.danger),
            _ => None,
        };
        let at = chat
            .last_at
            .unwrap_or(chat.created_at)
            .max(status.map(|s| s.updated_at).unwrap_or(0.));
        let age = format::age(at, format::now_ms(), format::lang());
        let id = chat.id.clone();
        let active = self.route == (Route::Chat { id: id.clone() });
        let menu = Self::chat_menu(&cx.entity(), chat.id.clone(), chat.title.clone());
        let more = more_button(format!("chat-more-{}", chat.id), chat_title(chat), menu.clone());
        NavRow::new(SharedString::from(format!("chat-{}", chat.id)), chat_title(chat))
            .menu(menu)
            .on_hover_trailing(more)
            .leading(leading)
            .when_some(detail, |r, d| r.detail(d, tone))
            .trailing(div().text_xs().text_color(p.text_dim).child(age))
            .indent(0.)
            .active(active)
            .emphasis(state == FaceState::Waiting)
            .on_click(cx.listener(move |this, _, _, cx| this.go(Route::Chat { id: id.clone() }, cx)))
    }

    /// A group's rows: the first five plus the open chat, then "Show N more" / "Show less".
    pub(super) fn group_rows(
        &self,
        key: &str,
        chats: Vec<&Chat>,
        lists: &Lists,
        window: &Window,
        cx: &Context<Self>,
    ) -> Vec<(String, AnyElement)> {
        let (store, statuses) = (lists.store, lists.statuses);
        // The order shown: dropped or being dragged first.
        let natural: Vec<String> = chats.iter().map(|c| c.id.clone()).collect();
        let shown = self.display(key, natural);
        let mut chats = chats;
        chats.sort_by_key(|c| shown.iter().position(|id| *id == c.id).unwrap_or(usize::MAX));
        let all = self.show_all.contains(key);
        let open = match &self.route {
            Route::Chat { id } => Some(id.clone()),
            _ => None,
        };
        let total = chats.len();
        let visible: Vec<&Chat> = chats
            .into_iter()
            .enumerate()
            .filter(|(i, c)| all || *i < VISIBLE || Some(&c.id) == open.as_ref())
            .map(|(_, c)| c)
            .collect();
        let hidden = total - visible.len();
        // Drag to reorder within this group, live; the group's new order goes to the engine on the drop.
        let dragging = self.preview.as_ref().map(|p| p.dragged.clone());
        let mut rows: Vec<(String, AnyElement)> = visible
            .into_iter()
            .map(|c| {
                let row = self
                    .chat_row(c, statuses.get(&c.id), store, window, cx)
                    .reorder(self.reorder_of(key, &c.id, chat_title(c), chat_mark(c, statuses.get(&c.id), store), cx))
                    .lifted(dragging.as_deref() == Some(c.id.as_str()))
                    .into_any_element();
                (c.id.clone(), row)
            })
            .collect();
        if total > VISIBLE {
            let label = if all {
                t!("nav.showLess").into_owned()
            } else {
                tn("nav.showMore", hidden as i64)
            };
            let key = key.to_string();
            let p = theme::palette(window);
            rows.push((
                "more".to_string(),
                NavRow::new(SharedString::from(format!("more-{key}")), label)
                    .leading(div().size(px(20.)))
                    .indent(0.)
                    .trailing(div().text_color(p.text_dim))
                    .on_click(cx.listener(move |this, _, _, cx| {
                        if !this.show_all.remove(&key) {
                            this.show_all.insert(key.clone());
                        }
                        cx.notify();
                    }))
                    .into_any_element(),
            ));
        }
        rows
    }

    /// A section's label row: name, a summary while closed (how many wait), and its "+".
    pub(super) fn section(
        &self,
        key: &'static str,
        (label, waiting): (String, usize),
        add: Option<AnyElement>,
        turn: Pixels,
        window: &Window,
        cx: &Context<Self>,
    ) -> AnyElement {
        let p = theme::palette(window);
        let closed = Prefs::get(cx).collapsed_sections.contains(key);
        div()
            .id(SharedString::from(format!("section-{key}")))
            .flex()
            .items_center()
            .gap(px(space::X0_5))
            .h(px(tokens::CONTROL_H))
            .pl(px(space::X2_5))
            .pr(px(space::X1))
            .mt(px(space::X2))
            .text_size(px(11.5))
            .font_weight(FontWeight::MEDIUM)
            .text_color(p.text_muted)
            .cursor_pointer()
            .on_click(cx.listener(move |this, _, _, cx| this.toggle_section(key, cx)))
            .child(div().flex_1().child(label))
            .when(closed && waiting > 0, |r| {
                r.child(
                    div()
                        .mr(px(space::X1))
                        .text_color(p.warning)
                        .child(tn("nav.waitingIn", waiting as i64)),
                )
            })
            .child(
                div()
                    .flex()
                    .flex_none()
                    .items_center()
                    .justify_center()
                    .size(px(tokens::CONTROL_H_XS))
                    .child(
                        icon(IconName::ChevronDown, icon::XS)
                            .text_color(p.text_dim)
                            .rotate(radians(f32::from(turn).to_radians())),
                    ),
            )
            .when_some(add, |r, a| r.child(a))
            .into_any_element()
    }
}

/// A chat's ghost mark: the face of the agent who worked last, else the default chat mark.
pub(super) fn chat_mark(chat: &Chat, status: Option<&ChatStatus>, store: &Store) -> DragMark {
    status
        .and_then(|s| s.agent_id.as_deref())
        .or(chat.agent_ids.first().map(String::as_str))
        .map_or(DragMark::Icon(IconName::MessageCircle), |agent| {
            DragMark::Face(store.tone(Some(agent)))
        })
}

/// The ⋯ button that opens a row's menu (same items as its right-click).
pub(super) fn more_button(id: String, name: String, menu: crate::ui::nav::MenuBuilder) -> impl IntoElement {
    let trigger = Button::icon_only(
        SharedString::from(format!("{id}-trigger")),
        IconName::Ellipsis,
        t!("nav.moreFor", name = name).into_owned(),
    )
    .size(Size::Xs);
    crate::ui::menu::dropdown(SharedString::from(id), trigger, menu)
}
