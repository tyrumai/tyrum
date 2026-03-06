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
  const { core, isEnterOpen, requestEnter, closeEnter } = useElevatedModeUiContext();
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

  const issueDeviceToken = async (): Promise<void> => {
    const deviceId = core.deviceId?.trim();
    if (!deviceId) {
      throw new Error("Current client device identity is unavailable.");
    }

    const issued = await core.http.deviceTokens.issue({
      device_id: deviceId,
      role: "client",
      scopes: [
        "operator.read",
        "operator.write",
        "operator.approvals",
        "operator.pairing",
        "operator.admin",
      ],
      ttl_seconds: 60 * 10,
    });

    core.elevatedModeStore.enter({
      elevatedToken: issued.token,
      expiresAt: issued.expires_at,
    });
  };

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
      await issueDeviceToken();
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
          <DialogTitle>Enter Elevated Mode</DialogTitle>
          <DialogDescription>
            Elevated Mode enables dangerous operator actions. It is time-limited and can be exited
            at any time. Entering it uses your current authenticated session.
          </DialogDescription>
        </DialogHeader>

        <div className="mt-4 grid gap-5">
          <label className="flex items-center gap-3 text-sm text-fg">
            <input type="checkbox" data-testid="elevated-mode-confirm" ref={confirmRef} />
            <span>I understand and want to proceed.</span>
          </label>

          {errorMessage ? (
            <Alert variant="error" title="Elevated Mode error" description={errorMessage} />
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
            Enter Elevated Mode
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
