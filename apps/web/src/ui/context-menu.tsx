// Right-click menus (and the keyboard's Menu key / Shift+F10): React Aria's Menu in a popover anchored where the
// pointer was, or under the focused element when the keyboard asked. `menuFor` turns the element that was
// right-clicked into the items for it (or nothing: no menu there). The browser's own menu never shows inside.
import { type ReactNode, type MouseEvent as ReactMouseEvent, useRef, useState } from "react"
import { Menu as MenuPrimitive, Popover } from "react-aria-components"

export function ContextMenu({ label, menuFor, children, className }: { label: string; menuFor: (target: HTMLElement) => ReactNode | undefined; children: ReactNode; className?: string }) {
  const anchor = useRef<HTMLSpanElement>(null)
  const [open, setOpen] = useState<{ x: number; y: number; items: ReactNode }>()
  const onContextMenu = (e: ReactMouseEvent<HTMLDivElement>) => {
    const items = menuFor(e.target as HTMLElement)
    if (!items) return
    e.preventDefault()
    // A keyboard-opened menu has no pointer position: anchor it under the focused element.
    const keyboard = e.clientX === 0 && e.clientY === 0
    const rect = (e.target as HTMLElement).getBoundingClientRect()
    setOpen({ x: keyboard ? rect.left + 16 : e.clientX, y: keyboard ? rect.bottom : e.clientY, items })
  }
  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: forwards the contextmenu event of the rows inside; the rows stay the interactive elements
    <div className={className} onContextMenu={onContextMenu}>
      {children}
      <span ref={anchor} aria-hidden="true" className="pointer-events-none fixed size-0" style={{ left: open?.x ?? 0, top: open?.y ?? 0 }} />
      <Popover
        triggerRef={anchor}
        isOpen={!!open}
        onOpenChange={(o) => !o && setOpen(undefined)}
        placement="bottom start"
        offset={2}
        className="z-50 min-w-48 rounded-card border border-strong bg-float p-1 shadow-float backdrop-blur-xl backdrop-saturate-150 outline-none data-entering:animate-in data-entering:fade-in-0 data-entering:zoom-in-[0.98] data-exiting:animate-out data-exiting:fade-out-0 motion-reduce:animate-none"
      >
        <MenuPrimitive aria-label={label} autoFocus="first" onAction={() => setOpen(undefined)} className="outline-none">
          {open?.items}
        </MenuPrimitive>
      </Popover>
    </div>
  )
}
