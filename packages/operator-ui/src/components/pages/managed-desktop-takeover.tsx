import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { useCallback, useState } from "react";
import { useApiAction } from "../../hooks/use-api-action.js";
import { cn } from "../../lib/cn.js";
import type { AdminHttpClient } from "./admin-http-shared.js";
import { Dialog, DialogClose, DialogOverlay, DialogPortal, DialogTitle } from "../ui/dialog.js";

type ActiveManagedDesktopTakeoverSession = {
  title: string;
  entryUrl: string;
};

export function ManagedDesktopTakeoverDialog({
  session,
  onClose,
}: {
  session: ActiveManagedDesktopTakeoverSession | null;
  onClose: () => void;
}) {
  return (
    <Dialog
      open={session !== null}
      onOpenChange={(open) => {
        if (!open) {
          onClose();
        }
      }}
    >
      <DialogPortal>
        <DialogOverlay />
        <DialogPrimitive.Content
          aria-describedby={undefined}
          className={cn(
            "fixed inset-4 z-50 flex flex-col overflow-hidden rounded-lg border border-border bg-bg-card text-fg shadow-md",
            "data-[state=open]:tyrum-animate-dialog-in data-[state=closed]:tyrum-animate-dialog-out",
          )}
        >
          <div className="flex items-center justify-between gap-4 border-b border-border px-4 py-3">
            <div className="min-w-0">
              <DialogTitle className="text-base">Managed Desktop Takeover</DialogTitle>
              <div className="truncate text-sm text-fg-muted">{session?.title ?? ""}</div>
            </div>
            <DialogClose
              aria-label="Close"
              className={cn(
                "rounded-md p-1 text-fg-muted opacity-70 transition-opacity hover:opacity-100",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring focus-visible:ring-offset-2 focus-visible:ring-offset-bg",
              )}
            >
              <X aria-hidden="true" className="h-4 w-4" />
            </DialogClose>
          </div>
          {session ? (
            <iframe
              title={session.title}
              src={session.entryUrl}
              className="min-h-0 flex-1 border-0 bg-black"
              allowFullScreen
              data-testid="managed-desktop-takeover-frame"
            />
          ) : null}
        </DialogPrimitive.Content>
      </DialogPortal>
    </Dialog>
  );
}

export function useManagedDesktopTakeover(params: {
  getAdminHttp: () => AdminHttpClient | null;
  requestEnter: () => void;
}) {
  const action = useApiAction<ActiveManagedDesktopTakeoverSession>();
  const [session, setSession] = useState<ActiveManagedDesktopTakeoverSession | null>(null);

  const open = useCallback(
    async (input: { environmentId: string; title: string }): Promise<void> => {
      const httpClient = params.getAdminHttp();
      if (!httpClient) {
        params.requestEnter();
        return;
      }

      const nextSession = await action.runAndThrow(async () => {
        const result = await httpClient.desktopEnvironments.createTakeoverSession(
          input.environmentId,
        );
        return {
          title: input.title,
          entryUrl: result.session.entry_url,
        };
      });
      setSession(nextSession);
    },
    [action, params],
  );

  const close = useCallback(() => {
    setSession(null);
  }, []);

  return {
    close,
    error: action.error,
    isLoading: action.isLoading,
    open,
    session,
  };
}
