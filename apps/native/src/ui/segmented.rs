// A segmented choice (prototype `.seg`, apps/web/src/ui/segmented.tsx): a 3px track at the control radius, 24px
// options at the segment radius (control radius − track, concentric), 12.5px medium. The chosen one sits on a marker
// that slides to the next choice on a spring (measured from the options as laid out), so the row never jumps.
use std::rc::Rc;

use gpui_kit::{
    base::{Spring, spring},
    prelude::FluentBuilder,
    *,
};

use crate::ui::space;
use crate::{
    theme::{self, tokens},
    ui::motion,
};

const TRACK: f32 = 3.;
const OPTION_H: f32 = 24.;

pub type OnPick = Rc<dyn Fn(usize, &mut Window, &mut App) + 'static>;

#[derive(IntoElement)]
pub struct Segmented {
    id: ElementId,
    /// What screen readers call the group.
    name: SharedString,
    options: Vec<SharedString>,
    selected: usize,
    on_pick: OnPick,
}

impl Segmented {
    pub fn new(
        id: impl Into<ElementId>,
        name: impl Into<SharedString>,
        options: Vec<SharedString>,
        selected: usize,
        on_pick: OnPick,
    ) -> Self {
        Self {
            id: id.into(),
            name: name.into(),
            options,
            selected,
            on_pick,
        }
    }
}

/// Where each option was laid out last frame, relative to the track: (left, width).
#[derive(Default)]
struct Laid(Vec<(Pixels, Pixels)>);

impl RenderOnce for Segmented {
    fn render(self, window: &mut Window, cx: &mut App) -> impl IntoElement {
        let p = theme::palette(window);
        let key = self.id.to_string();
        let laid = window.use_keyed_state(
            ElementId::from(SharedString::from(format!("{key}-laid"))),
            cx,
            |_, _| Laid::default(),
        );
        let target = laid.read(cx).0.get(self.selected).copied();
        // The marker springs to the chosen option; before the first layout it is drawn on the option itself.
        let marker = target.map(|(left, width)| {
            let policy = || Spring::new(std::time::Duration::from_millis(260)).with_damping(1.);
            let left = spring(SharedString::from(format!("{key}-x")), left, policy(), window, cx);
            let width = spring(SharedString::from(format!("{key}-w")), width, policy(), window, cx);
            div()
                .absolute()
                .top(px(TRACK))
                .left(left)
                .w(width)
                .h(px(OPTION_H))
                .rounded(px(tokens::RADIUS_SEG))
                .bg(p.bg_control_active)
        });
        let measured = marker.is_some();
        let options = self.options.into_iter().enumerate().map(|(i, label)| {
            let id = ElementId::from(SharedString::from(format!("{key}-option-{i}")));
            let pointer = motion::pointer(&id, window, cx);
            let on = i == self.selected;
            let lit = on || pointer.read(cx).hovered;
            let fg = motion::color(&id, "fg", if lit { p.text } else { p.text_muted }, window, cx);
            let on_pick = self.on_pick.clone();
            let option = div()
                .id(id.clone())
                .role(Role::RadioButton)
                .aria_label(label.clone())
                .aria_selected(on)
                .flex()
                .flex_none()
                .items_center()
                .h(px(OPTION_H))
                .px(px(space::X2_5))
                .rounded(px(tokens::RADIUS_SEG))
                .when(on && !measured, |o| o.bg(p.bg_control_active))
                .text_size(px(12.5))
                .font_weight(FontWeight::MEDIUM)
                .text_color(fg)
                .on_click(move |_, window, cx| on_pick(i, window, cx))
                .child(label);
            motion::track(option, &pointer)
        });
        div()
            .on_children_prepainted(move |bounds, _, cx| {
                // The marker (when drawn) is the first child: the options follow it.
                let options: Vec<Bounds<Pixels>> = bounds.into_iter().skip(usize::from(measured)).collect();
                let Some(first) = options.first() else { return };
                let origin = first.origin.x - px(TRACK);
                let next: Vec<(Pixels, Pixels)> = options.iter().map(|b| (b.origin.x - origin, b.size.width)).collect();
                laid.update(cx, |l, cx| {
                    if l.0 != next {
                        l.0 = next;
                        cx.notify();
                    }
                });
            })
            .id(self.id)
            .role(Role::RadioGroup)
            .aria_label(self.name)
            .relative()
            .flex()
            .flex_none()
            .items_center()
            .gap(px(space::X0_5))
            .p(px(TRACK))
            .rounded(px(tokens::RADIUS_CONTROL))
            .bg(p.bg_control)
            .children(marker)
            .children(options)
    }
}
