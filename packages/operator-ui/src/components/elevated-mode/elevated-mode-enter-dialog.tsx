import { createTyrumHttpClient } from "@tyrum/client";
import { useEffect, useRef, useState } from "react";
import { Alert } from "../ui/alert.js";
import { Button } from "../ui/button.js";
import { Input } from "../ui/input.js";
import { Label } from "../ui/label.js";
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
import { resolveTyrumHttpFetch } from "../../utils/tyrum-http-fetch.js";

export function ElevatedModeEnterDialog() {
  const { core, mode, isEnterOpen, requestEnter, closeEnter } = useElevatedModeUiContext();
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(busy);
  busyRef.current = busy;
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [revealToken, setRevealToken] = useState(false);
  const confirmRef = useRef<HTMLInputElement | null>(null);
  const tokenRef = useRef<HTMLInputElement | null>(null);

  const resetForm = (): void => {
    setErrorMessage(null);
    setRevealToken(false);
    if (tokenRef.current) {
      tokenRef.current.value = "";
    }
    if (confirmRef.current) {
      confirmRef.current.checked = false;
    }
  };

  useEffect(() => {
    if (isEnterOpen) return;
    resetForm();
  }, [isEnterOpen]);

  const issueDeviceToken = async (accessToken: string): Promise<void> => {
    const http = createTyrumHttpClient({
      baseUrl: core.httpBaseUrl,
      auth: { type: "bearer", token: accessToken },
      fetch: resolveTyrumHttpFetch(mode),
    });

    const issued = await http.deviceTokens.issue({
      device_id: "operator-ui",
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

    const accessToken = tokenRef.current?.value.trim() ?? "";
    if (!accessToken) {
      setErrorMessage("Elevated access token is required");
      return;
    }

    setBusy(true);
    setErrorMessage(null);
    try {
      await issueDeviceToken(accessToken);
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
          tokenRef.current?.focus();
        }}
      >
        <DialogHeader>
          <DialogTitle>Enter Elevated Mode</DialogTitle>
          <DialogDescription>
            Elevated Mode enables dangerous operator actions. It is time-limited and can be exited
            at any time.
          </DialogDescription>
        </DialogHeader>

        <div className="mt-4 grid gap-5">
          <label className="flex items-center gap-3 text-sm text-fg">
            <input type="checkbox" data-testid="elevated-mode-confirm" ref={confirmRef} />
            <span>I understand and want to proceed.</span>
          </label>

          <div className="grid gap-2">
            <Label htmlFor="elevated-mode-token">Elevated access token</Label>
            <div className="flex items-center gap-2">
              <div className="flex-1">
                <Input
                  id="elevated-mode-token"
                  data-testid="elevated-mode-token"
                  ref={tokenRef}
                  type={revealToken ? "text" : "password"}
                  spellCheck={false}
                  autoCapitalize="none"
                  autoCorrect="off"
                  autoComplete="off"
                />
              </div>
              <Button
                type="button"
                size="sm"
                variant="outline"
                data-testid="elevated-mode-token-toggle"
                disabled={busy}
                aria-pressed={revealToken}
                onClick={() => {
                  setRevealToken((prev) => !prev);
                }}
              >
                {revealToken ? "Hide" : "Show"}
              </Button>
            </div>
          </div>

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
