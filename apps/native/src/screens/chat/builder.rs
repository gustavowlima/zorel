// The chat in Builder mode ("create agents"): Zorel proposes agents, you edit them, approve or decline, and see
// the ones made.
use super::*;

impl ChatScreen {
    /// A conversation with the Builder: its intro, its proposal as a card, and what you write while a proposal is out
    /// asks for a change (it declines the proposal with your words).
    pub fn builder(mut self) -> Self {
        self.builder = Some(BuilderMode::default());
        self
    }

    /// The Builder's open proposal (an agent or a team to create).
    pub(super) fn proposal(&self) -> Option<&crate::net::types::Approval> {
        self.builder.as_ref()?;
        self.log.approvals.iter().rev().find(|a| a.tool == "zorel_create_agent")
    }

    pub(super) fn drafts(&self) -> Vec<crate::net::types::ProposedAgent> {
        match self.proposal().and_then(|a| a.proposal.clone()) {
            Some(crate::net::types::ProposalOf::Create { agents }) => agents,
            _ => Vec::new(),
        }
    }

    /// Agents this conversation made (the server's clock on both sides).
    pub(super) fn made(&self, cx: &App) -> Vec<(crate::net::types::Agent, usize)> {
        let store = self.store.read(cx);
        let since = store.chat(&self.chat_id).map_or(f64::MAX, |c| c.created_at);
        store
            .agents
            .iter()
            .filter(|a| a.builtin.is_none() && a.archived_at.is_none() && a.created_at >= since)
            .map(|a| (a.clone(), store.tone(Some(&a.id))))
            .collect()
    }

    /// Create (approved, with what was edited) or Discard (denied).
    pub(super) fn decide_proposal(&mut self, approve: bool, cx: &mut Context<Self>) {
        let Some(approval) = self.proposal().map(|a| a.id.clone()) else {
            return;
        };
        let count = self.drafts().len();
        let Some(mode) = &mut self.builder else { return };
        mode.busy = true;
        mode.editing = None;
        let overrides: Vec<serde_json::Value> = (0..count)
            .map(|i| {
                let e = mode.edits.get(i).cloned().unwrap_or_default();
                let mut o = json!({});
                if let Some(m) = e.model {
                    o["model"] = json!(m.model);
                    o["accountId"] = json!(m.account_id);
                    o["effort"] = json!(m.effort);
                }
                if let Some(a) = e.access {
                    o["access"] = serde_json::to_value(a).unwrap_or_default();
                }
                o
            })
            .collect();
        let mut payload = json!({ "approvalId": approval, "outcome": if approve { "approved" } else { "denied" } });
        if approve {
            payload["overrides"] = json!(overrides);
        }
        let (rpc, store) = (self.rpc.clone(), self.store.downgrade());
        cx.spawn(async move |this, cx| {
            let done =
                runtime::spawn(async move { rpc.call::<serde_json::Value>("decide", Some(payload)).await }).await;
            if !matches!(done, Ok(Ok(_))) {
                let _ = this.update(cx, |this, cx| {
                    if let Some(m) = &mut this.builder {
                        m.busy = false;
                    }
                    cx.notify();
                });
            }
            let _ = store.update(cx, |s, cx| s.load(cx)); // the new agents
        })
        .detach();
        self.relayout(cx);
        cx.notify();
    }

    /// The open proposal's setup drawer (one proposed agent), over the conversation.
    pub(super) fn editor(&mut self, window: &mut Window, cx: &mut Context<Self>) -> Option<AnyElement> {
        let i = self.builder.as_ref()?.editing?;
        let drafts = self.drafts();
        let draft = drafts.get(i)?.clone();
        let store = self.store.clone();
        let view = cx.entity().downgrade();
        let mode = self.builder.as_mut()?;
        let picker = mode
            .pickers
            .entry(i)
            .or_insert_with(|| {
                let view = view.clone();
                let on_change: crate::screens::model_picker::OnChange = Rc::new(move |choice, _, cx| {
                    let _ = view.update(cx, |this, cx| {
                        if let Some(m) = &mut this.builder
                            && let Some(e) = m.edits.get_mut(i)
                        {
                            e.model = Some(choice);
                        }
                        cx.notify();
                    });
                });
                cx.new(|cx| ModelPicker::new(store.clone(), false, on_change, window, cx))
            })
            .clone();
        let edit = mode.edits.get(i).cloned().unwrap_or_default();
        let value = edit.model.clone().unwrap_or(ModelChoice {
            model: draft.model.clone(),
            account_id: None,
            effort: None,
        });
        picker.update(cx, |p, cx| p.set_value(value, cx));
        let tone = self.store.read(cx).agents.len() + i;
        let (access, close) = (view.clone(), view);
        Some(crate::screens::proposal::editor(
            crate::screens::proposal::Editor {
                index: i,
                draft: &draft,
                edit,
                tone,
                picker: picker.into_any_element(),
                on_access: Rc::new(move |i, a, _, cx| {
                    let _ = access.update(cx, |this, cx| {
                        if let Some(m) = &mut this.builder
                            && let Some(e) = m.edits.get_mut(i)
                        {
                            e.access = Some(a);
                        }
                        cx.notify();
                    });
                }),
                on_close: Rc::new(move |_, cx| {
                    let _ = close.update(cx, |this, cx| {
                        if let Some(m) = &mut this.builder {
                            m.editing = None;
                        }
                        cx.notify();
                    });
                }),
            },
            window,
            cx,
        ))
    }

    pub(super) fn proposal_row(&mut self, window: &mut Window, cx: &mut Context<Self>) -> AnyElement {
        let drafts = self.drafts();
        let approval = self.proposal().map(|a| a.id.clone());
        let Some(mode) = &mut self.builder else {
            return div().into_any_element();
        };
        // A new proposal starts from what the Builder proposed.
        if mode.approval != approval {
            *mode = BuilderMode {
                approval,
                ..BuilderMode::default()
            };
        }
        mode.edits.resize(drafts.len(), Default::default());
        let edits = mode.edits.clone();
        let busy = mode.busy;
        let first_tone = self.store.read(cx).agents.len();
        let models = self.store.read(cx).models.clone();
        let (create, discard, edit) = (
            cx.entity().downgrade(),
            cx.entity().downgrade(),
            cx.entity().downgrade(),
        );
        crate::screens::proposal::card(
            crate::screens::proposal::Card {
                drafts: &drafts,
                edits: &edits,
                first_tone,
                busy,
                models: &models,
                on_create: Rc::new(move |_, cx| {
                    let _ = create.update(cx, |this, cx| this.decide_proposal(true, cx));
                }),
                on_discard: Rc::new(move |_, cx| {
                    let _ = discard.update(cx, |this, cx| this.decide_proposal(false, cx));
                }),
                on_edit: Rc::new(move |i, _, cx| {
                    let _ = edit.update(cx, |this, cx| {
                        if let Some(m) = &mut this.builder {
                            m.editing = Some(i);
                        }
                        cx.notify();
                    });
                }),
            },
            window,
        )
    }
}
