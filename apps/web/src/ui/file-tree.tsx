// A folder's files as an editor's explorer: React Aria's Tree, so it gets arrow keys, type-ahead, multi-select
// (Shift / Cmd / Ctrl + click, Shift + arrows) and drag and drop (pointer, keyboard and screen reader) from the
// library. A row can turn into an input to rename it in place. Dropping on a folder moves into it; on a file,
// into that file's folder; on the empty space below, into the top folder. Virtualized (React Aria's Virtualizer):
// only the rows in view are in the page, so a big repository scrolls like a small one. The tree is its own scroll
// box and fills its parent's height.
import { type ReactNode, useRef } from "react"
import { Button, type Key, ListLayout, Tree, TreeItem, TreeItemContent, useDragAndDrop, Virtualizer } from "react-aria-components"
import { cn } from "@/lib/utils"
import { FileIcon } from "./file-icon"
import { ChevronRight, Folder, FolderOpen } from "./icons"

export type FileNode = { readonly name: string; readonly path: string; readonly children: ReadonlyArray<FileNode> | null } // null: a file

const ROW = 28 // px: h-control-sm, the Virtualizer's fixed row height
export const parentOf = (path: string) => path.slice(0, Math.max(0, path.lastIndexOf("/")))

export function FileTree({
  label,
  nodes,
  expanded,
  onExpandedChange,
  selected,
  onSelectionChange,
  renaming,
  onRenamed,
  onAction,
  onMove,
  onKey,
  trailing,
  strong
}: {
  label: string
  nodes: ReadonlyArray<FileNode>
  expanded: ReadonlySet<string>
  onExpandedChange: (keys: Set<string>) => void
  selected: ReadonlySet<string>
  onSelectionChange: (keys: Set<string>) => void
  renaming: string | null // the path whose row shows the rename input
  onRenamed: (name: string | null) => void // null: cancelled
  onAction: (node: FileNode) => void // double-click or Enter
  onMove: (paths: ReadonlyArray<string>, folder: string) => void
  onKey: (key: string, e: { metaKey: boolean; ctrlKey: boolean }) => boolean // true: handled (F2, Delete…)
  trailing?: (node: FileNode) => ReactNode // a row's mark (status)
  strong?: (node: FileNode) => boolean // the name in full ink
}) {
  const folders = new Set<string>()
  const walk = (ns: ReadonlyArray<FileNode>) => {
    for (const n of ns)
      if (n.children) {
        folders.add(n.path)
        walk(n.children)
      }
  }
  walk(nodes)
  const dragged = useRef<string[]>([])
  const { dragAndDropHooks } = useDragAndDrop({
    getItems: (keys) => [...keys].map((k) => ({ "text/plain": String(k) })),
    onDragStart: (e) => {
      dragged.current = [...e.keys].map(String)
    },
    getDropOperation: (target) => (target.type === "root" || target.dropPosition === "on" ? "move" : "cancel"),
    onMove: (e) => {
      const key = String(e.target.key)
      onMove([...e.keys].map(String), folders.has(key) ? key : parentOf(key))
    },
    onRootDrop: () => onMove(dragged.current, "")
  })
  const row = (n: FileNode, depth: number): ReactNode => (
    <TreeItem key={n.path} id={n.path} textValue={n.name} className="group/row outline-none transition-[opacity,scale] duration-150 ease-out data-dragging:scale-[0.98] data-dragging:opacity-40 motion-reduce:transition-none">
      <TreeItemContent>
        {({ isExpanded, isFocusVisible, isHovered, isSelected, isDropTarget }) => (
          <div
            className={cn(
              "flex h-control-sm min-w-0 cursor-default items-center gap-1.5 rounded-control pr-1.5 text-sm transition-colors duration-120 ease-out motion-reduce:transition-none",
              isSelected ? "bg-accent-soft text-fg" : isHovered && "bg-hover",
              isDropTarget && "bg-accent-soft ring-1 ring-accent",
              isFocusVisible && "ring-2 ring-accent"
            )}
            style={{ paddingLeft: 6 + depth * 12 }}
          >
            {n.children ? (
              <Button slot="chevron" excludeFromTabOrder className="flex size-4 shrink-0 items-center justify-center text-muted outline-none">
                <ChevronRight className={cn("size-3 transition-transform duration-150 ease-out motion-reduce:transition-none", isExpanded && "rotate-90")} />
              </Button>
            ) : (
              <span className="size-4 shrink-0" />
            )}
            {n.children ? isExpanded ? <FolderOpen className="size-4 shrink-0 text-muted" /> : <Folder className="size-4 shrink-0 text-muted" /> : <FileIcon name={n.name} />}
            {renaming === n.path ? (
              <RenameInput name={n.name} onDone={onRenamed} />
            ) : (
              <span className={cn("min-w-0 flex-1 truncate", strong?.(n) || isSelected ? "text-fg" : "text-secondary")}>{n.name}</span>
            )}
            {trailing?.(n)}
          </div>
        )}
      </TreeItemContent>
      {n.children?.map((c) => row(c, depth + 1))}
    </TreeItem>
  )
  return (
    <div
      className="h-full"
      // Capture: runs before the tree's own keys (its Enter opens the row; on macOS Enter renames).
      onKeyDownCapture={(e) => {
        if (e.target instanceof HTMLInputElement) return
        if (onKey(e.key, e)) {
          e.preventDefault()
          e.stopPropagation()
        }
      }}
    >
      <Virtualizer layout={ListLayout} layoutOptions={{ rowHeight: ROW, gap: 1, padding: 4, dropIndicatorThickness: 2 }}>
        <Tree
          aria-label={label}
          selectionMode="multiple"
          selectionBehavior="replace"
          expandedKeys={expanded as Iterable<Key>}
          onExpandedChange={(keys) => onExpandedChange(new Set([...keys].map(String)))}
          selectedKeys={selected as Iterable<Key>}
          onSelectionChange={(keys) => onSelectionChange(new Set(keys === "all" ? [] : [...keys].map(String)))}
          onAction={(key) => {
            const find = (ns: ReadonlyArray<FileNode>): FileNode | undefined => ns.reduce<FileNode | undefined>((f, n) => f ?? (n.path === key ? n : n.children ? find(n.children) : undefined), undefined)
            const n = find(nodes)
            if (n) onAction(n)
          }}
          dragAndDropHooks={dragAndDropHooks}
          className="block h-full overflow-auto outline-none data-drop-target:bg-accent-faint"
        >
          {nodes.map((n) => row(n, 0))}
        </Tree>
      </Virtualizer>
    </div>
  )
}

// The name in place: Enter saves, Escape or an unchanged name cancels; the name without its extension is selected.
function RenameInput({ name, onDone }: { name: string; onDone: (name: string | null) => void }) {
  const done = useRef(false)
  const finish = (v: string | null) => {
    if (done.current) return
    done.current = true
    onDone(v?.trim() && v.trim() !== name ? v.trim() : null)
  }
  return (
    <input
      aria-label={name}
      defaultValue={name}
      // biome-ignore lint/a11y/noAutofocus: the user asked to rename this row
      autoFocus
      onFocus={(e) => {
        const dot = name.lastIndexOf(".")
        e.currentTarget.setSelectionRange(0, dot > 0 ? dot : name.length)
      }}
      onKeyDown={(e) => {
        e.stopPropagation() // the tree's keys (type-ahead, space, arrows) stay out of the input
        if (e.key === "Enter") finish(e.currentTarget.value)
        if (e.key === "Escape") finish(null)
      }}
      onPointerDown={(e) => e.stopPropagation()}
      onBlur={(e) => finish(e.currentTarget.value)}
      className="h-5 min-w-0 flex-1 rounded-control border border-accent bg-canvas px-1 text-sm text-fg outline-none"
    />
  )
}
