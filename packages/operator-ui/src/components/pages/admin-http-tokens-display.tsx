import {
  createMobileBootstrapUrl,
  inferGatewayWsUrl,
  normalizeGatewayHttpBaseUrl,
} from "@tyrum/schemas";
import type * as React from "react";
import QRCode from "qrcode";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { useClipboard } from "../../utils/clipboard.js";
import { Alert } from "../ui/alert.js";
import { Badge } from "../ui/badge.js";
import { Button } from "../ui/button.js";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "../ui/dialog.js";
import { Input } from "../ui/input.js";
import type { AuthTokenIssueResult } from "./admin-http-tokens-shared.js";
import { formatTimestamp } from "./admin-http-tokens-shared.js";

function MobileBootstrapQrDialog({
  open,
  bootstrapUrl,
  onOpenChange,
}: {
  open: boolean;
  bootstrapUrl: string;
  onOpenChange: (open: boolean) => void;
}): React.ReactElement {
  const [svg, setSvg] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    let active = true;
    setSvg(null);
    setErrorMessage(null);

    void QRCode.toString(bootstrapUrl, {
      type: "svg",
      errorCorrectionLevel: "M",
      margin: 1,
      width: 256,
    })
      .then((nextSvg) => {
        if (!active) return;
        setSvg(nextSvg);
        setErrorMessage(null);
      })
      .catch((error: unknown) => {
        if (!active) return;
        setSvg(null);
        setErrorMessage(error instanceof Error ? error.message : String(error));
      });

    return () => {
      active = false;
    };
  }, [bootstrapUrl, open]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Mobile bootstrap QR</DialogTitle>
          <DialogDescription>
            Scan this code in Tyrum Mobile or open the copied mobile link on the device.
          </DialogDescription>
        </DialogHeader>

        {errorMessage ? (
          <Alert variant="error" title="QR generation failed" description={errorMessage} />
        ) : svg ? (
          <div
            className="mx-auto w-full max-w-[18rem] rounded-lg border border-border bg-white p-3"
            dangerouslySetInnerHTML={{ __html: svg }}
          />
        ) : (
          <div className="text-sm text-fg-muted">Generating QR…</div>
        )}
      </DialogContent>
    </Dialog>
  );
}

export function SummaryBadge({
  label,
  value,
}: {
  label: string;
  value: number;
}): React.ReactElement {
  return <Badge variant="outline">{`${label}: ${String(value)}`}</Badge>;
}

export function IssuedTokenNotice({
  token,
  gatewayHttpBaseUrl,
  onDismiss,
}: {
  token: AuthTokenIssueResult;
  gatewayHttpBaseUrl: string;
  onDismiss: () => void;
}): React.ReactElement {
  const clipboard = useClipboard();
  const [qrOpen, setQrOpen] = useState(false);
  const mobileBootstrapUrl = useMemo(
    () =>
      createMobileBootstrapUrl({
        v: 1,
        httpBaseUrl: normalizeGatewayHttpBaseUrl(gatewayHttpBaseUrl),
        wsUrl: inferGatewayWsUrl(gatewayHttpBaseUrl),
        token: token.token,
      }),
    [gatewayHttpBaseUrl, token.token],
  );

  return (
    <div
      data-testid="admin-http-token-secret-panel"
      className="grid gap-3 rounded-lg border border-success/30 p-4"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <Alert
          variant="success"
          title="Token created"
          description="Copy this secret now. It will not be shown again after you dismiss it."
          className="min-w-0 flex-1"
        />
        <Button
          type="button"
          size="sm"
          variant="secondary"
          data-testid="admin-http-token-secret-dismiss"
          onClick={onDismiss}
        >
          Dismiss
        </Button>
      </div>

      <div className="grid gap-2 text-sm text-fg-muted sm:grid-cols-2">
        <div>
          <span className="font-medium text-fg">Name:</span> {token.display_name}
        </div>
        <div>
          <span className="font-medium text-fg">Role:</span> {token.role}
        </div>
        <div>
          <span className="font-medium text-fg">Device:</span> {token.device_id ?? "Optional"}
        </div>
        <div>
          <span className="font-medium text-fg">Expires:</span> {formatTimestamp(token.expires_at)}
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          size="sm"
          variant="outline"
          data-testid="admin-http-token-mobile-qr"
          onClick={() => {
            setQrOpen(true);
          }}
        >
          Show mobile QR
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          data-testid="admin-http-token-mobile-link-copy"
          disabled={!clipboard.canWrite}
          onClick={() => {
            void clipboard
              .writeText(mobileBootstrapUrl)
              .then(() => {
                toast.success("Copied mobile link");
              })
              .catch(() => {
                toast.error("Failed to copy mobile link");
              });
          }}
        >
          Copy mobile link
        </Button>
      </div>

      <Input
        label="Token secret"
        readOnly
        spellCheck={false}
        autoCapitalize="none"
        autoCorrect="off"
        value={token.token}
        className="font-mono text-xs"
        suffix={
          <button
            type="button"
            data-testid="admin-http-token-secret-copy"
            className="text-xs font-medium text-fg-muted enabled:hover:text-fg disabled:opacity-50"
            disabled={!clipboard.canWrite}
            onClick={() => {
              void clipboard
                .writeText(token.token)
                .then(() => {
                  toast.success("Copied to clipboard");
                })
                .catch(() => {
                  toast.error("Failed to copy to clipboard");
                });
            }}
          >
            Copy
          </button>
        }
      />

      <MobileBootstrapQrDialog
        open={qrOpen}
        bootstrapUrl={mobileBootstrapUrl}
        onOpenChange={setQrOpen}
      />
    </div>
  );
}
