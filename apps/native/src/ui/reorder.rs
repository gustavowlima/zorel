// Drag to reorder, live (sidebar places, projects, chats): while you drag, the list already shows the new order;
// the dragged row stays in it, lifted, and the others slide to their new places (FLIP: each row remembers where it
// was laid out within its list and eases from there to where it is now). Nothing follows the pointer as a copy.
// Dropping commits the order; letting go elsewhere puts everything back.
use std::{cell::RefCell, collections::HashMap, rc::Rc};

use gpui_kit::*;

use crate::ui::motion;

/// The live order while a drag is on: which group, which row, over which row and on which side of it.
#[derive(Clone, Debug, PartialEq)]
pub struct Preview {
    pub group: String,
    pub dragged: String,
    pub target: String,
    pub after: bool,
}

impl Preview {
    /// `ids` in the order the drag shows now.
    pub fn apply(&self, group: &str, ids: &[String]) -> Vec<String> {
        if self.group != group || !ids.contains(&self.dragged) || self.target == self.dragged {
            return ids.to_vec();
        }
        let mut out: Vec<String> = ids.iter().filter(|id| **id != self.dragged).cloned().collect();
        let at = out
            .iter()
            .position(|id| *id == self.target)
            .map_or(out.len(), |i| i + usize::from(self.after));
        out.insert(at, self.dragged.clone());
        out
    }
}

/// Whether hovering `target` should move the dragged row: only once the pointer is past the target's middle in the
/// direction of travel (below it when the target is below, above it when above). Without this the rows swap back
/// and forth while the pointer rests on a middle that is itself sliding.
pub fn crosses(order: &[String], dragged: &str, target: &str, after: bool) -> bool {
    let (Some(d), Some(t)) = (
        order.iter().position(|id| id == dragged),
        order.iter().position(|id| id == target),
    ) else {
        return true;
    };
    if t > d { after } else { !after }
}

/// Where each row of a list was last laid out (relative to the list), and the slide it is playing.
#[derive(Clone, Default)]
pub struct Flip(Rc<RefCell<HashMap<String, Slot>>>);

#[derive(Clone, Copy, Default)]
struct Slot {
    y: f32,
    from: f32,
    run: u32,
}

impl Flip {
    /// Draws `rows` (keyed) as a column whose rows slide from their last place to their new one. `changed` redraws.
    pub fn list(
        &self,
        group: &str,
        rows: Vec<(String, AnyElement)>,
        gap: f32,
        changed: impl Fn(&mut App) + 'static,
    ) -> Div {
        let keys: Vec<String> = rows.iter().map(|(k, _)| format!("{group}/{k}")).collect();
        let slots = self.0.clone();
        let measure = keys.clone();
        let children = rows.into_iter().zip(&keys).map(|((_, row), key)| {
            let slot = self.0.borrow().get(key).copied().unwrap_or_default();
            // The slide plays inside a wrapper that never moves: the wrapper is what's measured, so a row on its
            // way doesn't read as moved again (which restarted the slide every frame and flung rows away).
            let inner = if slot.run == 0 || slot.from.abs() < 0.5 {
                row
            } else {
                let from = slot.from;
                div()
                    .child(row)
                    .with_animation(
                        SharedString::from(format!("flip-{key}-{}", slot.run)),
                        Animation::new(motion::ms(motion::REORDER_MS)).with_easing(motion::ease_out_cubic),
                        move |el, t| el.relative().top(px(from * (1. - t))),
                    )
                    .into_any_element()
            };
            div().flex_none().child(inner).into_any_element()
        });
        div()
            .flex()
            .flex_col()
            .gap(px(gap))
            .on_children_prepainted(move |bounds, _, cx| {
                let Some(top) = bounds.first().map(|b| f32::from(b.origin.y)) else {
                    return;
                };
                let mut moved = false;
                let mut slots = slots.borrow_mut();
                for (key, b) in measure.iter().zip(&bounds) {
                    let y = f32::from(b.origin.y) - top;
                    match slots.get_mut(key) {
                        Some(slot) if (slot.y - y).abs() > 0.5 => {
                            *slot = Slot {
                                y,
                                from: slot.y - y,
                                run: slot.run + 1,
                            };
                            moved = true;
                        }
                        Some(_) => {}
                        None => {
                            slots.insert(key.clone(), Slot { y, from: 0., run: 0 });
                        }
                    }
                }
                drop(slots);
                if moved {
                    changed(cx);
                }
            })
            .children(children)
    }
}

/// What a dragged row carries (a NavRow's drag payload): its group and id.
pub use crate::ui::nav::DragRow;

/// Called while dragging over a row (dragged, target, the pointer is past the target's middle).
pub type OnOver = Rc<dyn Fn(&DragRow, &DragRow, bool, &mut Window, &mut App) + 'static>;
/// Called when a dragged row is dropped on a row of its group.
pub type OnDrop = Rc<dyn Fn(&DragRow, &mut Window, &mut App) + 'static>;

/// What follows the pointer while a row is dragged: the row itself, lifted (its mark, its name, its width), while its
/// place in the list stays open and the others slide around it.
pub struct Ghost(pub DragRow);

impl Render for Ghost {
    fn render(&mut self, window: &mut Window, _: &mut Context<Self>) -> impl IntoElement {
        let p = crate::theme::palette(window);
        let row = &self.0;
        let mark: Option<AnyElement> = match row.mark {
            DragMark::Face(tone) => Some(
                crate::ui::face::AgentFace::new(SharedString::from(format!("ghost-face-{}", row.id)), tone)
                    .size(20.)
                    .into_any_element(),
            ),
            DragMark::Icon(name) => Some(
                crate::ui::icon::icon(name, crate::ui::icon::MD)
                    .text_color(p.text)
                    .into_any_element(),
            ),
            DragMark::None => None,
        };
        div()
            .flex()
            .items_center()
            .gap(px(crate::ui::space::X2_5))
            .w(px(row.width))
            .h(px(crate::theme::tokens::CONTROL_H))
            .px(px(crate::ui::space::X2_5))
            .rounded(px(crate::theme::tokens::RADIUS_ROW))
            // Exactly the row's size and type, washed and lifted by a soft shadow: no border, no entrance, so it
            // doesn't look like it grows when the drag starts.
            .bg(p.bg_surface)
            .shadow_md()
            .text_color(p.text)
            .children(mark)
            .child(div().flex_1().min_w_0().truncate().child(row.label.clone()))
    }
}

/// What a dragged row shows before its name.
#[derive(Clone, Copy)]
pub enum DragMark {
    Face(usize),
    Icon(gpui_kit::assets::IconName),
    None,
}

#[cfg(test)]
mod tests {
    use super::Preview;

    #[test]
    fn rows_swap_only_past_the_middle_in_the_direction_of_travel() {
        let order: Vec<String> = ["a", "b", "c"].iter().map(|s| s.to_string()).collect();
        // Dragging a down over b: only its lower half moves it.
        assert!(!super::crosses(&order, "a", "b", false));
        assert!(super::crosses(&order, "a", "b", true));
        // Dragging c up over b: only its upper half.
        assert!(super::crosses(&order, "c", "b", false));
        assert!(!super::crosses(&order, "c", "b", true));
    }

    #[test]
    fn the_preview_moves_the_dragged_row() {
        let ids: Vec<String> = ["a", "b", "c"].iter().map(|s| s.to_string()).collect();
        let p = |target: &str, after: bool| Preview {
            group: "g".into(),
            dragged: "a".into(),
            target: target.into(),
            after,
        };
        assert_eq!(p("c", false).apply("g", &ids), ["b", "a", "c"]);
        assert_eq!(p("c", true).apply("g", &ids), ["b", "c", "a"]);
        assert_eq!(p("c", true).apply("other", &ids), ["a", "b", "c"]);
    }
}
