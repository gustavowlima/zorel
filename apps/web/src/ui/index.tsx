// Design system primitives. Features import from here (@/ui); they don't style controls by hand.
import { cn } from "@/lib/utils"
import type { ReactNode } from "react"

export { cn } from "@/lib/utils"
export { AgentAvatar, ModelAvatar, toneOf } from "./avatar"
export { AgentFace, EmptyOrbit, type FaceState, PersonAvatar, WorkingRing } from "./face"
export { Button, type ButtonProps, IconButton } from "./button"
export { ChoiceCards } from "./choice"
export { CheckList, Tick } from "./checklist"
export { CodeBlock, ShimmerText, TableFrame } from "./code-block"
export { ConfirmButton, ConfirmDialog, Dialog } from "./dialog"
export { ContextMenu } from "./context-menu"
export { DateRangeField, type DayRange } from "./date-range"
export { pickFiles } from "./files"
export { ImageViewer } from "./image-viewer"
export * from "./icons"
export { BareTextarea, ColorField, Input, SearchInput, Textarea } from "./input"
export { OptionList, OptionRow } from "./option-list"
export { BrandMark, type Brand, Code, Column, column, EmptyState, HEADER, IconTile, ListRow, Meter, Notice, PageHeader, RowHit, Rows, SettingRow, Screen, Section } from "./layout"
export { diffLines, LineDiff } from "./line-diff"
export { Logo } from "./logo"
export { Menu, MenuItem, MenuSeparator } from "./menu"
export { AgentPointer } from "./pointer"
export { type CommandItem, CommandPalette, type CommandSection } from "./command"
export { Drawer, Fold, ListPresence, Marker, MotionConfig, PresenceRow, Reflow, Rise, SETTLE, SlideWidth, spring, Width } from "./motion"
export { MultiSegmented, Segmented } from "./segmented"
export { StepSlider } from "./slider"
export { FileIcon } from "./file-icon"
export { type FileStatus, StatusMark } from "./status-mark"
export { FileTree, type FileNode, parentOf } from "./file-tree"
export { DragList, SortableList } from "./sortable"
export { NavItem, NavLabel, NavTree, NavTreeItem, type NavKey, useNavReorder } from "./nav"
export { I18nProvider } from "react-aria-components" // React Aria's own strings follow Zorel's language
export { FieldButton, OptionButton, RailButton } from "./picker"
export { DisclosurePill, Dot, Tag } from "./pill"
export { Popover } from "./popover"
export { ProviderIcon } from "./provider-icon"
export { Select, type SelectOption } from "./select"
export { ChatStatusIcon, Spinner } from "./spinner"
export { StepHead, StepList, StepNote, StepRow } from "./step-tree"
export { Milestone, Milestones } from "./milestones"
export { Switch } from "./switch"
export { Tab, TabList, TabPanel, Tabs } from "./tabs"
export { Tooltip } from "./tooltip"

// A field: its label 8px above the control, a hint under it in the dim tone. The hint sits outside the <label>, so it
// isn't read as part of the control's name.
export function Field({ label, hint, children, className }: { label: string; hint?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <div className={cn("flex flex-col gap-2", className)}>
      {/* biome-ignore lint/a11y/noLabelWithoutControl: `children` is always a control (Input, Select, Textarea, ModelPicker) */}
      <label className="flex flex-col gap-2 text-sm text-muted">
        {label}
        {children}
      </label>
      {hint && <span className="-mt-0.5 text-sm text-dim">{hint}</span>}
    </div>
  )
}

export const Badge = ({ tone = "neutral", children }: { tone?: "neutral" | "accent" | "success" | "warning" | "danger"; children: ReactNode }) => (
  <span
    className={cn(
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

export { OrbitBackdrop } from "./orbit"
export { MarkOpening, OnboardingSet, StepColumn, StepHeader, type StepAction, StepTransition } from "./onboarding"
