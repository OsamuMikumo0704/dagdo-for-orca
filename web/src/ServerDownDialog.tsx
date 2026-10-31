import { Dialog } from "radix-ui";
import { LoaderCircle } from "lucide-react";

/** Non-dismissable on purpose: without the server no action can be saved. */
export function ServerDownDialog({ open }: { open: boolean }) {
  return <Dialog.Root open={open}>
    <Dialog.Portal>
      <Dialog.Overlay className="fixed inset-0 z-[80] bg-black/60" />
      <Dialog.Content role="alertdialog" aria-describedby="server-down-description" className="fixed left-1/2 top-1/2 z-[90] w-[min(440px,calc(100vw-32px))] -translate-x-1/2 -translate-y-1/2 rounded-xl border border-border bg-background p-6 text-foreground shadow-xl">
        <Dialog.Title className="text-lg font-semibold">dagdo server is not connected</Dialog.Title>
        <p id="server-down-description" className="text-sm text-muted-foreground mt-2">Start dagdo with the start shortcut on your Desktop. This page can't start it for you. Editing is paused, and this page reconnects automatically.</p>
        <p role="status" className="text-sm mt-4 flex items-center gap-2"><LoaderCircle aria-hidden="true" className="h-4 w-4 motion-safe:animate-spin" />Waiting for the server…</p>
      </Dialog.Content>
    </Dialog.Portal>
  </Dialog.Root>;
}
