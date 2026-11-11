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
      {/* Full screen: the whole window darkens (nothing of the chat shows through), a thin bar on top with the name,
          the original and close, and the image centered at the largest size that fits. A click on the dark area closes. */}
      <ModalOverlay
        isDismissable
        className="app-full fixed inset-0 z-50 bg-canvas/95 backdrop-blur-sm data-entering:animate-in data-entering:fade-in-0 data-exiting:animate-out data-exiting:fade-out-0 data-exiting:duration-100 motion-reduce:animate-none"
      >
        <Modal className="app-full fixed inset-0 outline-none">
          <Dialog aria-label={name} className="flex h-full flex-col outline-none">
            {({ close }) => (
              <>
                <header className="flex shrink-0 items-center gap-2 px-4 py-2.5">
                  <Heading slot="title" className="min-w-0 flex-1 truncate text-sm text-secondary">
                    {name}
                  </Heading>
                  <a href={src} target="_blank" rel="noreferrer" className="inline-flex h-control-sm items-center gap-1 rounded-control px-2 text-sm text-muted outline-none hover:bg-control hover:text-fg focus-visible:ring-2 focus-visible:ring-accent">
                    {openLabel}
                    <ArrowUpRight className="size-3.5" />
                  </a>
                  <IconButton label={closeLabel} size="sm" onPress={close} autoFocus>
                    <X className="size-4" />
                  </IconButton>
                </header>
                {/* biome-ignore lint/a11y/noStaticElementInteractions: a click on the backdrop closes; Esc and the close button do too */}
                {/* biome-ignore lint/a11y/useKeyWithClickEvents: the keyboard closes with Esc (the modal's own) */}
                <div className="flex min-h-0 flex-1 items-center justify-center px-6 pb-6" onClick={(e) => e.target === e.currentTarget && close()}>
                  <img src={src} alt={name} className="max-h-full max-w-full rounded-control object-contain shadow-float animate-in fade-in-0 zoom-in-98 duration-200 motion-reduce:animate-none" />
                </div>
              </>
            )}
          </Dialog>
        </Modal>
      </ModalOverlay>
    </DialogTrigger>
  )
}
