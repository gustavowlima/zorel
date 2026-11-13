// Dragging to reorder places, projects and chats: the order shown while dragging, and saving it on the drop.
use super::*;

impl Sidebar {
    // PUT the group's new order after a drop: a project's chats, or the loose ones (projectId null).
    /// The order `group` shows now: what was just dropped (until the engine has it), then the live drag.
    pub(super) fn display(&self, group: &str, natural: Vec<String>) -> Vec<String> {
        let base = match self.held.get(group) {
            Some((held, at)) if at.elapsed() < std::time::Duration::from_secs(4) && same_set(held, &natural) => {
                held.clone()
            }
            _ => natural,
        };
        let order = match &self.preview {
            Some(preview) => preview.apply(group, &base),
            None => base,
        };
        self.shown.borrow_mut().insert(group.to_string(), order.clone());
        order
    }

    /// A row's part in a live reorder: dragging over it moves the dragged row there; dropping keeps that order.
    pub(super) fn reorder_of(
        &self,
        group: &str,
        id: &str,
        label: String,
        mark: DragMark,
        cx: &Context<Self>,
    ) -> Reorder {
        let folded = Prefs::get(cx).sidebar_folded;
        let row = DragRow {
            group: group.to_string().into(),
            id: id.to_string().into(),
            label: label.into(),
            mark,
            // The ghost is as wide as the row it lifts (the open sidebar's content, or the rail's square).
            width: if folded { RAIL_ITEM } else { OPEN_WIDTH - 2. * space::X3 },
        };
        let (over, dropped) = (cx.entity().downgrade(), cx.entity().downgrade());
        let on_over: OnOver = Rc::new(move |dragged, target, after, _, cx| {
            let preview = Preview {
                group: dragged.group.to_string(),
                dragged: dragged.id.to_string(),
                target: target.id.to_string(),
                after,
            };
            let _ = over.update(cx, |this, cx| {
                let order = this
                    .shown
                    .borrow()
                    .get(dragged.group.as_ref())
                    .cloned()
                    .unwrap_or_default();
                if !crate::ui::reorder::crosses(&order, &dragged.id, &target.id, after) {
                    return;
                }
                if this.preview.as_ref() != Some(&preview) {
                    this.preview = Some(preview);
                    cx.notify();
                }
            });
        });
        let on_drop: OnDrop = Rc::new(move |_, _, cx| {
            let _ = dropped.update(cx, |this, cx| this.commit(cx));
        });
        (row, on_over, on_drop)
    }

    /// The drop: the order shown becomes the order (the engine's for projects and chats, the prefs' for places).
    pub(super) fn commit(&mut self, cx: &mut Context<Self>) {
        let Some(preview) = self.preview.take() else { return };
        let store = self.store.read(cx);
        let group = preview.group.clone();
        let natural: Vec<String> = match group.as_str() {
            "places" => self.place_order(cx),
            "projects" => store.projects.iter().map(|p| p.id.clone()).collect(),
            key => {
                let statuses = lifted(&store.chats.chats, &store.chats.statuses);
                let chats: Vec<&Chat> = store
                    .chats
                    .chats
                    .iter()
                    .filter(|c| c.parent_id.is_none() && c.project_id.as_deref() == (key != LOOSE).then_some(key))
                    .collect();
                ordered(chats, &statuses).iter().map(|c| c.id.clone()).collect()
            }
        };
        let base = match self.held.get(&group) {
            Some((held, _)) if same_set(held, &natural) => held.clone(),
            _ => natural,
        };
        let ids = preview.apply(&group, &base);
        self.held
            .insert(group.clone(), (ids.clone(), std::time::Instant::now()));
        let store = self.store.downgrade();
        match group.as_str() {
            "places" => {
                Prefs::update(cx, |p| p.places = ids);
            }
            "projects" => Self::put_order(&store, "/api/projects/order", serde_json::json!({ "ids": ids }), cx),
            key => {
                let project = (key != LOOSE).then(|| key.to_string());
                Self::put_order(
                    &store,
                    "/api/chats/order",
                    serde_json::json!({ "projectId": project, "ids": ids }),
                    cx,
                )
            }
        }
        cx.notify();
    }

    /// The places' ids in the person's order (new places at the end).
    pub(super) fn place_order(&self, cx: &App) -> Vec<String> {
        let mut ids: Vec<String> = Prefs::get(cx)
            .places
            .iter()
            .filter(|id| PLACES.contains(&id.as_str()))
            .cloned()
            .collect();
        let missing: Vec<String> = PLACES
            .iter()
            .map(|p| p.to_string())
            .filter(|p| !ids.contains(p))
            .collect();
        ids.extend(missing);
        ids
    }

    pub(super) fn put_order(store: &WeakEntity<Store>, path: &'static str, body: serde_json::Value, cx: &mut App) {
        let _ = store.update(cx, |s, cx| {
            s.write(crate::state::store::Method::Put, path, body, cx).detach()
        });
    }
}
