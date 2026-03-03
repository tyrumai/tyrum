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
import { useAdminModeUiContext } from "./admin-mode-provider.js";
import { formatErrorMessage } from "../../utils/format-error-message.js";

export function AdminModeEnterDialog() {
  const { core, mode, isEnterOpen, requestEnter, closeEnter } = useAdminModeUiContext();
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
    const requestBody = {
      device_id: "operator-ui",
      role: "client" as const,
      scopes: [
        "operator.read",
        "operator.write",
        "operator.approvals",
        "operator.pairing",
        "operator.admin",
      ],
      ttl_seconds: 60 * 10,
    };
    const applyIssuedToken = (issued: { token: string; expires_at: string }): void => {
      core.adminModeStore.enter({
        elevatedToken: issued.token,
        expiresAt: issued.expires_at,
      });
    };
    const issued = await core.http.deviceTokens.issue(requestBody);
    applyIssuedToken(issued);
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
        data-testid="admin-mode-dialog"
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
          <DialogTitle>Enter Admin Mode</DialogTitle>
          <DialogDescription>
            Admin Mode enables dangerous operator actions. It is time-limited and can be exited at
            any time.
          </DialogDescription>
        </DialogHeader>

        <div className="mt-4 grid gap-5">
          <label className="flex items-center gap-3 text-sm text-fg">
            <input type="checkbox" data-testid="admin-mode-confirm" ref={confirmRef} />
            <span>I understand and want to proceed.</span>
          </label>

          {mode === "desktop" ? (
            <p className="text-sm text-fg-muted">
              Desktop connection auth is used automatically for Admin Mode.
            </p>
          ) : (
            <p className="text-sm text-fg-muted">
              Your authenticated web session is used automatically for Admin Mode.
            </p>
          )}

          {errorMessage ? (
            <Alert variant="error" title="Admin Mode error" description={errorMessage} />
          ) : null}
        </div>

        <DialogFooter>
          <Button
            type="button"
            data-testid="admin-mode-cancel"
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
            data-testid="admin-mode-submit"
            isLoading={busy}
            onClick={() => {
              void submit();
            }}
          >
            Enter Admin Mode
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
