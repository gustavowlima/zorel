// An image opened inside Zorel: a modal over the dimmed app with the image as large as fits, its name, a link to
// the original and a close button. React Aria's modal: Esc, a click outside or the button closes it, focus is
// trapped inside and returns to the thumbnail. The trigger is the thumbnail itself (a pressable button).
import type { ReactNode } from "react"
import { Button, Dialog, DialogTrigger, Heading, Modal, ModalOverlay } from "react-aria-components"
import { cn } from "@/lib/utils"
import { ArrowUpRight, X } from "./icons"
import { IconButton } from "./button"

export function ImageViewer({ src, name, closeLabel, openLabel, children, className }: { src: string; name: string; closeLabel: string; openLabel: string; children: ReactNode; className?: string }) {
  return (
    <DialogTrigger>
      <Button aria-label={name} className={cn("cursor-zoom-in rounded-card outline-none data-focus-visible:ring-2 data-focus-visible:ring-accent", className)}>
        {children}
      </Button>
      <ModalOverlay
        isDismissable
        className="fixed inset-0 z-50 flex items-center justify-center bg-overlay p-6 data-entering:animate-in data-entering:fade-in-0 data-exiting:animate-out data-exiting:fade-out-0 motion-reduce:animate-none"
      >
        <Modal className="flex max-h-full max-w-full outline-none data-entering:animate-in data-entering:zoom-in-95 motion-reduce:animate-none">
          <Dialog aria-label={name} className="flex max-h-full min-h-0 flex-col gap-3 outline-none">
            {({ close }) => (
              <>
                <header className="flex items-center gap-3 rounded-control bg-raised py-1 pr-1 pl-3">
                  <Heading slot="title" className="min-w-0 flex-1 truncate text-sm font-medium">
                    {name}
                  </Heading>
                  <a href={src} target="_blank" rel="noreferrer" className="inline-flex h-control-sm items-center gap-1 rounded-control px-2 text-sm text-muted outline-none hover:text-fg focus-visible:ring-2 focus-visible:ring-accent">
                    {openLabel}
                    <ArrowUpRight className="size-3.5" />
                  </a>
                  <IconButton label={closeLabel} size="xs" onPress={close} autoFocus>
                    <X className="size-4" />
                  </IconButton>
                </header>
                <img src={src} alt={name} className="min-h-0 max-w-full flex-1 rounded-card border border-strong bg-canvas object-contain" />
              </>
            )}
          </Dialog>
        </Modal>
      </ModalOverlay>
    </DialogTrigger>
  )
}
