// An on/off switch with its label (the web's ui/switch.tsx): a 32×18 track, the accent when on, its knob springing
// across; the whole row toggles. Pure drawing: the owner keeps the value and says what a toggle does.
use std::rc::Rc;

use gpui_kit::{base::spring, *};

use crate::{
    theme,
    ui::{motion, space},
};

pub type OnToggle = Rc<dyn Fn(bool, &mut Window, &mut App) + 'static>;

const TRACK_W: f32 = 32.;
const TRACK_H: f32 = 18.;
const KNOB: f32 = 14.;

pub fn switch(
    id: impl Into<SharedString>,
    label: String,
    on: bool,
    toggle: OnToggle,
    window: &mut Window,
    cx: &mut App,
) -> AnyElement {
    let p = theme::palette(window);
    let id: SharedString = id.into();
    let travel = TRACK_W - KNOB - 4.;
    let x = spring(
        SharedString::from(format!("{id}-knob")),
        px(if on { travel } else { 0. }),
        motion::settle(motion::SETTLE_MS),
        window,
        cx,
    );
    let track = motion::color(
        &ElementId::from(id.clone()),
        "track",
        if on { p.accent } else { p.border_strong },
        window,
        cx,
    );
    div()
        .id(id)
        .role(Role::Switch)
        .aria_label(label.clone())
        .aria_toggled(if on { Toggled::True } else { Toggled::False })
        .flex()
        .items_center()
        .gap(px(space::X2_5))
        .child(
            div()
                .flex_none()
                .relative()
                .w(px(TRACK_W))
                .h(px(TRACK_H))
                .rounded_full()
                .bg(track)
                .child(
                    div()
                        .absolute()
                        .top(px(2.))
                        .left(px(2.) + x)
                        .size(px(KNOB))
                        .rounded_full()
                        .bg(p.on_accent)
                        .shadow_sm(),
                ),
        )
        .child(div().text_color(p.text_secondary).child(label))
        .on_click(move |_, window, cx| toggle(!on, window, cx))
        .into_any_element()
}
