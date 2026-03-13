import { useEffect, useRef, useState } from "react";
import { Alert } from "../ui/alert.js";
import { Button } from "../ui/button.js";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../ui/dialog.js";
import { useElevatedModeUiContext } from "./elevated-mode-provider.js";
import { formatErrorMessage } from "../../utils/format-error-message.js";

export function ElevatedModeEnterDialog() {
  const { enterElevatedMode, isEnterOpen, requestEnter, closeEnter } = useElevatedModeUiContext();
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(busy);
  busyRef.current = busy;
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const confirmRef = useRef<HTMLInputElement | null>(null);

  const resetForm = (): void => {
    setErrorMessage(null);
    if (confirmRef.current) {
      confirmRef.current.checked = false;
    }
  };

  useEffect(() => {
    if (isEnterOpen) return;
    resetForm();
  }, [isEnterOpen]);

  const submit = async (): Promise<void> => {
    if (busyRef.current) return;

    const confirmed = confirmRef.current?.checked ?? false;
    if (!confirmed) {
      setErrorMessage("Confirmation is required");
      return;
    }

    setBusy(true);
    setErrorMessage(null);
    try {
      await enterElevatedMode();
      resetForm();
      closeEnter();
    } catch (error) {
      setErrorMessage(formatErrorMessage(error));
    } finally {
      setBusy(false);
    }
  };

  const closeDialog = (): void => {
    if (busyRef.current) return;
    resetForm();
    closeEnter();
  };

  return (
    <Dialog
      open={isEnterOpen}
      onOpenChange={(open) => {
        if (open) {
          requestEnter();
          return;
        }
        closeDialog();
      }}
    >
      <DialogContent
        data-testid="elevated-mode-dialog"
        aria-modal="true"
        onEscapeKeyDown={(event) => {
          if (busyRef.current) {
            event.preventDefault();
          }
        }}
        onPointerDownOutside={(event) => {
          if (busyRef.current) {
            event.preventDefault();
          }
        }}
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          confirmRef.current?.focus();
        }}
      >
        <DialogHeader>
          <DialogTitle>Authorize admin access</DialogTitle>
          <DialogDescription>
            Admin access enables dangerous operator actions for 10 minutes in the current app
            session. Authorizing it uses your current authenticated session.
          </DialogDescription>
        </DialogHeader>

        <div className="mt-4 grid gap-5">
          <label className="flex items-center gap-3 text-sm text-fg">
            <input type="checkbox" data-testid="elevated-mode-confirm" ref={confirmRef} />
            <span>I understand and want to proceed.</span>
          </label>

          {errorMessage ? (
            <Alert variant="error" title="Admin access error" description={errorMessage} />
          ) : null}
        </div>

        <DialogFooter>
          <Button
            type="button"
            data-testid="elevated-mode-cancel"
            variant="secondary"
            disabled={busy}
            onClick={() => {
              closeDialog();
            }}
          >
            Cancel
          </Button>
          <Button
            type="button"
            data-testid="elevated-mode-submit"
            isLoading={busy}
            onClick={() => {
              void submit();
            }}
          >
            Authorize admin access
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
