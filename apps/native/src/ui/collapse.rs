// Something that opens and closes in place (a sidebar section, a project's chats): its height springs between 0
// and what its content measures, the content fading with it, both ways. Measured on every paint, so content that
// grows while open (a new chat) eases in too. Until it has been measured once it is drawn at its natural height, so
// nothing "opens" when the app starts.
// Two halves because a view may draw it after giving up `&mut` access: `height` (springs; needs the window) before,
// `wrap` (layout and measuring) after.
use std::{cell::RefCell, collections::HashMap, rc::Rc};

use gpui_kit::{base::spring, prelude::FluentBuilder, *};

use crate::ui::{motion, space};

/// Side room inside the clip for what pokes out of a row (the drag grip sits on the row's edge).
pub const GUTTER: f32 = space::X2;

/// Content heights by key, as last laid out.
#[derive(Clone, Default)]
pub struct Measured(Rc<RefCell<HashMap<String, f32>>>);

impl Measured {
    /// The height to draw `key` at now (None: natural, not measured yet), springing toward open or closed.
    pub fn height(&self, key: &str, open: bool, window: &mut Window, cx: &mut App) -> Option<(Pixels, f32)> {
        let Some(full) = self.0.borrow().get(key).copied() else {
            // Not measured yet: open draws naturally; closed stays shut while it measures.
            return (!open).then_some((px(0.), 0.));
        };
        let now = spring(
            SharedString::from(format!("collapse-{key}")),
            px(if open { full } else { 0. }),
            motion::settle(motion::SETTLE_MS),
            window,
            cx,
        );
        let shown = if full > 0. {
            (f32::from(now) / full).clamp(0., 1.)
        } else {
            1.
        };
        Some((now, shown))
    }

    /// The content in a clipping box of `height` that measures it for the next frame (`changed` redraws).
    pub fn wrap(
        &self,
        key: &str,
        height: Option<(Pixels, f32)>,
        children: Vec<AnyElement>,
        changed: impl Fn(&mut App) + 'static,
    ) -> AnyElement {
        let (measured, key) = (self.0.clone(), key.to_string());
        div()
            .flex()
            .flex_col()
            // Room on the sides so what pokes out of a row (a drag grip) isn't clipped; the layout doesn't move.
            .mx(px(-GUTTER))
            .px(px(GUTTER))
            .on_children_prepainted(move |bounds, _, cx| {
                let Some(content) = bounds.first() else { return };
                let h = f32::from(content.size.height);
                let old = measured.borrow_mut().insert(key.clone(), h);
                if old.is_none_or(|o| (o - h).abs() > 0.5) {
                    changed(cx);
                }
            })
            .when_some(height, |d, (h, _)| d.h(h).overflow_hidden())
            .child(
                div()
                    .flex()
                    .flex_col()
                    .flex_none()
                    .gap(px(space::X0_5))
                    .when_some(height, |d, (_, shown)| d.opacity(shown))
                    .children(children),
            )
            .into_any_element()
    }
}
