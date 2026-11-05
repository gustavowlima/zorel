// Design system primitives. Features import from here (@/ui); they don't style controls by hand.
import { cn as cx } from "@/lib/utils"
import type { ReactNode } from "react"

export { cn as cx } from "@/lib/utils"
export { AgentAvatar, ModelAvatar, toneOf } from "./avatar"
export { Button, type ButtonProps, IconButton } from "./button"
export { ChoiceCards } from "./choice"
export { CodeBlock, ShimmerText, TableFrame } from "./code-block"
export { ConfirmButton, ConfirmDialog, Dialog } from "./dialog"
export { ContextMenu } from "./context-menu"
export { DateRangeField, type DayRange } from "./date-range"
export { pickFiles } from "./files"
export { ImageViewer } from "./image-viewer"
export * from "./icons"
export { BareTextarea, Input, SearchInput, Textarea } from "./input"
export { OptionList, OptionRow } from "./option-list"
export { Code, Column, EmptyState, ListRow, Meter, PageHeader, RowHit, Rows, Screen, Section } from "./layout"
export { diffLines, LineDiff } from "./line-diff"
export { LimitRing, type RingTone } from "./limit-ring"
export { Logo } from "./logo"
export { Menu, MenuItem, MenuSeparator } from "./menu"
export { type CommandItem, CommandPalette, type CommandSection } from "./command"
export { Fold, Marker, MotionConfig, SlideWidth, spring, Width } from "./motion"
export { Segmented } from "./segmented"
export { FileIcon } from "./file-icon"
export { type FileStatus, StatusMark } from "./status-mark"
export { FileTree, type FileNode } from "./file-tree"
export { SortableList } from "./sortable"
export { NavItem, NavLabel, NavTree, NavTreeItem, type NavKey, useNavReorder } from "./nav"
export { I18nProvider } from "react-aria-components" // React Aria's own strings follow Zorel's language
export { FieldButton, OptionButton, RailButton } from "./picker"
export { DisclosurePill, Dot } from "./pill"
export { Popover } from "./popover"
export { ProviderIcon } from "./provider-icon"
export { Select, type SelectOption } from "./select"
export { ChatStatusIcon, Spinner } from "./spinner"
export { Switch } from "./switch"
export { Tab, TabList, TabPanel, Tabs } from "./tabs"
export { Tooltip } from "./tooltip"

export function Field({ label, hint, children, className }: { label: string; hint?: ReactNode; children: ReactNode; className?: string }) {
  return (
    // biome-ignore lint/a11y/noLabelWithoutControl: `children` is always a control (Input, Select, Textarea, ModelPicker)
    <label className={cx("flex flex-col gap-1.5 text-sm text-muted", className)}>
      {label}
      {children}
      {hint && <span className="text-sm text-dim">{hint}</span>}
    </label>
  )
}

export const Badge = ({ tone = "neutral", children }: { tone?: "neutral" | "accent" | "success" | "warning" | "danger"; children: ReactNode }) => (
  <span
    className={cx(
      "inline-flex h-5 shrink-0 items-center rounded-full px-2 text-xs font-medium",
      tone === "neutral" && "bg-control text-muted",
      tone === "accent" && "bg-accent-soft text-accent-text",
      tone === "success" && "bg-success-faint text-success",
      tone === "warning" && "bg-control text-warning",
      tone === "danger" && "bg-danger-soft text-danger"
    )}
  >
    {children}
  </span>
)

