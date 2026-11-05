// Command palette (Cmd+K): a modal with a search field over one list of sections. React Aria's Autocomplete
// keeps focus in the field while arrows move through the list and Enter runs the item. No filtering here: the
// screen passes the items that match (some come from the server).
import type { ReactNode } from "react"
import { Autocomplete, Dialog, Header, Input, Menu, MenuItem, MenuSection, Modal, ModalOverlay, SearchField } from "react-aria-components"
import { cn } from "@/lib/utils"
import { Search } from "./icons"

export type CommandItem = { id: string; label: ReactNode; text: string; hint?: ReactNode; icon?: ReactNode; onAction: () => void }
export type CommandSection = { id: string; title: string; items: ReadonlyArray<CommandItem> }

export function CommandPalette({
  isOpen,
  onOpenChange,
  query,
  onQuery,
  sections,
  label,
  placeholder,
  empty
}: {
  isOpen: boolean
  onOpenChange: (open: boolean) => void
  query: string
  onQuery: (q: string) => void
  sections: ReadonlyArray<CommandSection>
  label: string
  placeholder: string
  empty: ReactNode
}) {
  const shown = sections.filter((s) => s.items.length)
  return (
    <ModalOverlay isDismissable isOpen={isOpen} onOpenChange={onOpenChange} className="fixed inset-0 z-50 flex items-start justify-center bg-overlay p-4 pt-[12vh] data-entering:animate-in data-entering:fade-in-0 motion-reduce:animate-none">
      <Modal className="w-full max-w-xl overflow-hidden rounded-sheet border border-strong bg-float shadow-float backdrop-blur-xl backdrop-saturate-150 text-fg outline-none data-entering:animate-in data-entering:zoom-in-95 motion-reduce:animate-none">
        <Dialog aria-label={label} className="flex max-h-[60vh] flex-col outline-none">
          {({ close }) => (
            <Autocomplete inputValue={query} onInputChange={onQuery}>
              <SearchField aria-label={label} autoFocus className="flex items-center gap-2.5 border-b border-subtle px-4">
                <Search className="size-4 shrink-0 text-muted" />
                <Input placeholder={placeholder} className="h-12 min-w-0 flex-1 bg-transparent text-base outline-none placeholder:text-dim [&::-webkit-search-cancel-button]:hidden" />
              </SearchField>
              {shown.length ? (
                <Menu
                  aria-label={label}
                  className="min-h-0 flex-1 overflow-y-auto p-1.5 outline-none"
                  onAction={(key) => {
                    const item = shown.flatMap((s) => s.items).find((i) => i.id === key)
                    if (!item) return
                    close()
                    item.onAction()
                  }}
                >
                  {shown.map((s) => (
                    <MenuSection key={s.id} id={s.id} className="pb-1">
                      <Header className="px-2.5 pt-2 pb-1 text-sm font-medium text-muted">{s.title}</Header>
                      {s.items.map((i) => (
                        <MenuItem
                          key={i.id}
                          id={i.id}
                          textValue={i.text}
                          className={cn(
                            "flex cursor-default items-center gap-2.5 rounded-control px-2.5 py-2 text-secondary outline-none data-focused:bg-accent-soft data-focused:text-fg [&_svg]:size-4 [&_svg]:shrink-0 [&_svg]:text-muted data-focused:[&_svg]:text-accent-text"
                          )}
                        >
                          {i.icon}
                          <span className="flex min-w-0 flex-1 flex-col">
                            <span className="truncate">{i.label}</span>
                            {i.hint && <span className="truncate text-sm text-muted">{i.hint}</span>}
                          </span>
                        </MenuItem>
                      ))}
                    </MenuSection>
                  ))}
                </Menu>
              ) : (
                <p className="px-4 py-6 text-center text-sm text-muted">{empty}</p>
              )}
            </Autocomplete>
          )}
        </Dialog>
      </Modal>
    </ModalOverlay>
  )
}
