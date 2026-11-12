// Text you can select and copy (drag, double-click a word, ⌘C), with its styling: gpui-base's window selection
// (`TextSelection`, drawn by the `TextSelectionLayer` the root renders), joined by a run that keeps its highlights
// (bold, code, links), which gpui-base's own `SelectableText` (plain text only) drops. A link opens on a click that
// didn't drag.
use std::{cell::Cell, ops::Range, rc::Rc};

use gpui_kit::{
    base::{TextSelectionHandle, TextSelectionRegistration, TextSelectionRun},
    *,
};

pub struct Selectable {
    id: ElementId,
    text: SharedString,
    styled: StyledText,
    color: Hsla,
    links: Rc<Vec<(Range<usize>, Action)>>,
}

/// What clicking a range does (open a URL, open an agent).
pub type Action = Rc<dyn Fn(&mut Window, &mut App) + 'static>;

impl Selectable {
    /// `highlights` style ranges of `text`; `color` paints the selection.
    pub fn new(
        id: impl Into<ElementId>,
        text: impl Into<SharedString>,
        highlights: Vec<(Range<usize>, HighlightStyle)>,
        color: impl Into<Hsla>,
    ) -> Self {
        let text = text.into();
        Self {
            id: id.into(),
            styled: StyledText::new(text.clone()).with_highlights(highlights),
            text,
            color: color.into(),
            links: Rc::new(Vec::new()),
        }
    }

    /// Ranges that act when clicked (a link, a mention).
    pub fn links(mut self, links: Vec<(Range<usize>, Action)>) -> Self {
        self.links = Rc::new(links);
        self
    }
}

impl IntoElement for Selectable {
    type Element = Self;

    fn into_element(self) -> Self::Element {
        self
    }
}

impl Element for Selectable {
    type RequestLayoutState = TextSelectionHandle;
    type PrepaintState = Hitbox;

    fn id(&self) -> Option<ElementId> {
        Some(self.id.clone())
    }

    fn source_location(&self) -> Option<&'static std::panic::Location<'static>> {
        None
    }

    fn request_layout(
        &mut self,
        global_id: Option<&GlobalElementId>,
        inspector_id: Option<&InspectorElementId>,
        window: &mut Window,
        cx: &mut App,
    ) -> (LayoutId, Self::RequestLayoutState) {
        let text = self.text.clone();
        let handle = window.with_element_state(
            global_id.expect("Selectable has an id"),
            |kept: Option<TextSelectionHandle>, _| {
                let handle = kept.unwrap_or_else(|| TextSelectionHandle::new(text, cx));
                (handle.clone(), handle)
            },
        );
        let (layout_id, ()) = self.styled.request_layout(global_id, inspector_id, window, cx);
        (layout_id, handle)
    }

    fn prepaint(
        &mut self,
        global_id: Option<&GlobalElementId>,
        inspector_id: Option<&InspectorElementId>,
        bounds: Bounds<Pixels>,
        handle: &mut Self::RequestLayoutState,
        window: &mut Window,
        cx: &mut App,
    ) -> Self::PrepaintState {
        self.styled
            .prepaint(global_id, inspector_id, bounds, &mut (), window, cx);
        let hitbox = window.insert_hitbox(bounds, HitboxBehavior::Normal);
        let registration = TextSelectionRegistration::new(hitbox.clone(), bounds)
            .with_text_bounds(vec![bounds])
            .with_rendered_element(handle, window, cx);
        handle.register(registration, window, cx);
        hitbox
    }

    fn paint(
        &mut self,
        global_id: Option<&GlobalElementId>,
        inspector_id: Option<&InspectorElementId>,
        bounds: Bounds<Pixels>,
        handle: &mut Self::RequestLayoutState,
        hitbox: &mut Self::PrepaintState,
        window: &mut Window,
        cx: &mut App,
    ) {
        let layout = self.styled.layout().clone();
        let projection = handle.update_runs(&[TextSelectionRun::new(self.text.clone(), layout.clone(), bounds)], cx);
        for range in projection.ranges().iter().flatten() {
            paint_selection(&layout, range.clone(), self.color, window);
        }
        if !self.links.is_empty() {
            let over_link = |at: Point<Pixels>, layout: &TextLayout, links: &[(Range<usize>, Action)]| {
                layout
                    .index_for_position(at)
                    .ok()
                    .and_then(|ix| links.iter().position(|(r, _)| r.contains(&ix)))
            };
            if hitbox.is_hovered(window)
                && let Some(at) = Some(window.mouse_position())
                && over_link(at, &layout, &self.links).is_some()
            {
                window.set_cursor_style(CursorStyle::PointingHand, hitbox);
            }
            let pressed: Rc<Cell<Option<Point<Pixels>>>> = Rc::default();
            let (down, hb) = (pressed.clone(), hitbox.clone());
            window.on_mouse_event(move |e: &MouseDownEvent, phase, window, _| {
                if phase.bubble() && e.button == MouseButton::Left && hb.is_hovered(window) {
                    down.set(Some(e.position));
                }
            });
            let (links, hb) = (self.links.clone(), hitbox.clone());
            window.on_mouse_event(move |e: &MouseUpEvent, phase, window, cx| {
                let Some(start) = pressed.take() else { return };
                // A click, not the end of a drag that selected text.
                if phase.bubble()
                    && hb.is_hovered(window)
                    && (e.position - start).magnitude() < 3.
                    && let Some(i) = over_link(e.position, &layout, &links)
                {
                    (links[i].1)(window, cx);
                }
            });
        }
        self.styled
            .paint(global_id, inspector_id, bounds, &mut (), &mut (), window, cx);
    }
}

fn paint_selection(layout: &TextLayout, range: Range<usize>, color: Hsla, window: &mut Window) {
    let (Some(start), Some(end)) = (
        layout.position_for_index(range.start),
        layout.position_for_index(range.end),
    ) else {
        return;
    };
    let (bounds, line) = (layout.bounds(), layout.line_height());
    let mut quads = Vec::new();
    if start.y == end.y {
        quads.push(Bounds::from_corners(start, point(end.x, end.y + line)));
    } else {
        quads.push(Bounds::from_corners(start, point(bounds.right(), start.y + line)));
        if end.y > start.y + line {
            quads.push(Bounds::from_corners(
                point(bounds.left(), start.y + line),
                point(bounds.right(), end.y),
            ));
        }
        quads.push(Bounds::from_corners(
            point(bounds.left(), end.y),
            point(end.x, end.y + line),
        ));
    }
    for b in quads {
        window.paint_quad(fill(b, color));
    }
}
