import { useEffect, useRef, useState } from "react";
import { Alert } from "../ui/alert.js";
import { Button } from "../ui/button.js";
import { Checkbox } from "../ui/checkbox.js";
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
  const [confirmed, setConfirmed] = useState(false);

  const resetForm = (): void => {
    setErrorMessage(null);
    setConfirmed(false);
  };

  useEffect(() => {
    if (isEnterOpen) return;
    resetForm();
  }, [isEnterOpen]);

  const submit = async (): Promise<void> => {
    if (busyRef.current) return;

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
      >
        <DialogHeader>
          <DialogTitle>Authorize admin access</DialogTitle>
          <DialogDescription>
            Admin access enables dangerous operator actions for 10 minutes in the current app
            conversation. Authorizing it uses your current authenticated conversation.
          </DialogDescription>
        </DialogHeader>

        <div className="mt-4 grid gap-5">
          <label className="flex items-center gap-3 text-sm text-fg">
            <Checkbox
              data-testid="elevated-mode-confirm"
              checked={confirmed}
              onCheckedChange={(v) => setConfirmed(v === true)}
            />
            <span>I understand and want to proceed.</span>
          </label>

          {errorMessage ? (
            <Alert
              variant="error"
              title="Admin access error"
              description={errorMessage}
              onDismiss={() => setErrorMessage(null)}
            />
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
