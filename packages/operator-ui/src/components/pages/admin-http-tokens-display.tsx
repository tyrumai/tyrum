import type * as React from "react";
import { toast } from "sonner";
import { Alert } from "../ui/alert.js";
import { Badge } from "../ui/badge.js";
import { Input } from "../ui/input.js";
import type { AuthTokenIssueResult } from "./admin-http-tokens-shared.js";
import { formatTimestamp } from "./admin-http-tokens-shared.js";

async function copyText(text: string): Promise<void> {
  try {
    await globalThis.navigator.clipboard.writeText(text);
    toast.success("Copied to clipboard");
  } catch {
    toast.error("Failed to copy to clipboard");
  }
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

export function IssuedTokenNotice({ token }: { token: AuthTokenIssueResult }): React.ReactElement {
  return (
    <div
      data-testid="admin-http-token-secret-panel"
      className="grid gap-3 rounded-lg border border-success/30 p-4"
    >
      <Alert
        variant="success"
        title="Token created"
        description="Copy this secret now. It will not be shown again after you dismiss it."
      />

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
            onClick={() => {
              void copyText(token.token);
            }}
          >
            Copy
          </button>
        }
      />
    </div>
  );
}
