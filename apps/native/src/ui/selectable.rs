// Text you can select and copy (drag across texts, double-click a word, triple-click the text, ⌘C), with its
// styling (bold, code, links) and elements in its flow (a mention's face). It joins ui/text_select's per-frame
// registry, paints its slice of the selection under its glyphs, and listens at the window so a drag started here
// follows the pointer anywhere. A link or mention acts on a click that didn't drag. The I-beam over it.
use std::{cell::Cell, ops::Range, rc::Rc};

use gpui_kit::*;

use crate::ui::text_select;

pub struct Selectable {
    id: ElementId,
    text: SharedString,
    styled: StyledText,
    color: Hsla,
    links: Rc<Vec<(Range<usize>, Action)>>,
    /// Elements drawn in the text's flow, each at the start of the room left for it (a mention's face).
    inline: Vec<(usize, AnyElement)>,
    /// Rounded washes under ranges of the text (a mention's chip).
    chips: Vec<(Range<usize>, Hsla)>,
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
            inline: Vec::new(),
            chips: Vec::new(),
        }
    }

    /// Elements to draw at byte offsets of the text (the text leaves room for them), vertically centred on the line.
    pub fn inline(mut self, items: Vec<(usize, AnyElement)>) -> Self {
        self.inline = items;
        self
    }

    /// Rounded washes to paint under these ranges (behind the text and its selection).
    pub fn chips(mut self, chips: Vec<(Range<usize>, Hsla)>) -> Self {
        self.chips = chips;
        self
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
    type RequestLayoutState = ();
    type PrepaintState = (Hitbox, Vec<AnyElement>);

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
    ) -> (LayoutId, ()) {
        self.styled.request_layout(global_id, inspector_id, window, cx)
    }

    fn prepaint(
        &mut self,
        global_id: Option<&GlobalElementId>,
        inspector_id: Option<&InspectorElementId>,
        bounds: Bounds<Pixels>,
        _: &mut (),
        window: &mut Window,
        cx: &mut App,
    ) -> Self::PrepaintState {
        self.styled
            .prepaint(global_id, inspector_id, bounds, &mut (), window, cx);
        let hitbox = window.insert_hitbox(bounds, HitboxBehavior::Normal);
        // The inline elements, placed where their room starts on its line.
        let layout = self.styled.layout().clone();
        let line = layout.line_height();
        let mut placed = Vec::new();
        for (at, mut el) in std::mem::take(&mut self.inline) {
            let Some(origin) = layout.position_for_index(at) else {
                continue;
            };
            let size = el.layout_as_root(AvailableSpace::min_size(), window, cx);
            el.prepaint_at(
                point(origin.x + px(1.), origin.y + (line - size.height) / 2.),
                window,
                cx,
            );
            placed.push(el);
        }
        (hitbox, placed)
    }

    fn paint(
        &mut self,
        global_id: Option<&GlobalElementId>,
        inspector_id: Option<&InspectorElementId>,
        bounds: Bounds<Pixels>,
        _: &mut (),
        (hitbox, placed): &mut Self::PrepaintState,
        window: &mut Window,
        cx: &mut App,
    ) {
        let layout = self.styled.layout().clone();
        let key = self.id.to_string();
        text_select::register(&key, self.text.clone(), layout.clone());
        for (range, color) in &self.chips {
            for b in line_rects(&layout, range.clone()) {
                // A pill a little shorter than the line, so stacked lines don't touch.
                let b = Bounds::from_corners(point(b.left(), b.top() + px(2.)), point(b.right(), b.bottom() - px(2.)));
                window.paint_quad(fill(b, *color).corner_radii(b.size.height / 2.));
            }
        }
        if let Some(range) = text_select::range_of(&key) {
            paint_selection(&layout, range, self.color, window);
        }
        let over_link = |at: Point<Pixels>, layout: &TextLayout, links: &[(Range<usize>, Action)]| {
            layout
                .index_for_position(at)
                .ok()
                .and_then(|ix| links.iter().position(|(r, _)| r.contains(&ix)))
        };
        if hitbox.is_hovered(window) {
            let hand = over_link(window.mouse_position(), &layout, &self.links).is_some();
            window.set_cursor_style(
                if hand {
                    CursorStyle::PointingHand
                } else {
                    CursorStyle::IBeam
                },
                hitbox,
            );
        }
        let pressed: Rc<Cell<Option<Point<Pixels>>>> = Rc::default();
        {
            let (down, hb, key, text, layout) = (
                pressed.clone(),
                hitbox.clone(),
                key.clone(),
                self.text.clone(),
                layout.clone(),
            );
            window.on_mouse_event(move |e: &MouseDownEvent, phase, window, cx| {
                if phase != DispatchPhase::Bubble || e.button != MouseButton::Left {
                    return;
                }
                if hb.is_hovered(window) {
                    let ix = match layout.index_for_position(e.position) {
                        Ok(ix) | Err(ix) => ix,
                    };
                    text_select::begin(&key, &text, ix, e.click_count);
                    down.set(Some(e.position));
                    // Out of the message box, so ⌘C copies this selection, not the box's.
                    window.blur(cx);
                    window.refresh();
                }
            });
        }
        {
            let key = key.clone();
            window.on_mouse_event(move |e: &MouseMoveEvent, phase, window, _| {
                if phase == DispatchPhase::Bubble
                    && e.dragging()
                    && text_select::drags(&key)
                    && text_select::drag_to(e.position)
                {
                    window.refresh();
                }
            });
        }
        {
            let (links, hb, layout, key) = (self.links.clone(), hitbox.clone(), layout.clone(), key.clone());
            window.on_mouse_event(move |e: &MouseUpEvent, phase, window, cx| {
                if phase != DispatchPhase::Bubble || !text_select::drags(&key) {
                    return;
                }
                text_select::end();
                let Some(start) = pressed.take() else { return };
                // A click, not the end of a drag that selected text.
                if hb.is_hovered(window)
                    && (e.position - start).magnitude() < 3.
                    && let Some(i) = over_link(e.position, &layout, &links)
                {
                    (links[i].1)(window, cx);
                }
            });
        }
        self.styled
            .paint(global_id, inspector_id, bounds, &mut (), &mut (), window, cx);
        for el in placed {
            el.paint(window, cx);
        }
    }
}

fn paint_selection(layout: &TextLayout, range: Range<usize>, color: Hsla, window: &mut Window) {
    for b in line_rects(layout, range) {
        window.paint_quad(fill(b, color));
    }
}

/// One box per visual line a range covers, full line height.
fn line_rects(layout: &TextLayout, range: Range<usize>) -> Vec<Bounds<Pixels>> {
    let (Some(start), Some(end)) = (
        layout.position_for_index(range.start),
        layout.position_for_index(range.end),
    ) else {
        return Vec::new();
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
    quads
}
