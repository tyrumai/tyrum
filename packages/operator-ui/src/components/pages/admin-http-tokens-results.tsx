import type { AuthTokenListEntry } from "@tyrum/client/browser";
import { KeyRound } from "lucide-react";
import * as React from "react";
import { ElevatedModeTooltip } from "../elevated-mode/elevated-mode-tooltip.js";
import { Badge } from "../ui/badge.js";
import { Button } from "../ui/button.js";
import { EmptyState } from "../ui/empty-state.js";
import {
  formatAccessSummary,
  formatTimestamp,
  statusBadgeVariant,
  statusLabel,
} from "./admin-http-tokens-shared.js";

export function TokenResults({
  listBusy,
  tokens,
  visibleTokens,
  canMutate,
  requestEnter,
  onAddToken,
  onEditToken,
  onRevokeToken,
}: {
  listBusy: boolean;
  tokens: AuthTokenListEntry[];
  visibleTokens: AuthTokenListEntry[];
  canMutate: boolean;
  requestEnter: () => void;
  onAddToken: () => void;
  onEditToken: (token: AuthTokenListEntry) => void;
  onRevokeToken: (token: AuthTokenListEntry) => void;
}): React.ReactElement | null {
  if (!listBusy && visibleTokens.length === 0) {
    return (
      <EmptyState
        icon={KeyRound}
        title={tokens.length === 0 ? "No tenant tokens yet" : "No tokens match these filters"}
        description={
          tokens.length === 0
            ? "Create the first tenant token to manage access from the UI."
            : "Adjust the search or filters to see more tokens."
        }
        action={
          tokens.length === 0
            ? {
                label: "Add token",
                onClick: onAddToken,
                variant: "primary",
              }
            : undefined
        }
      />
    );
  }

  if (visibleTokens.length === 0) {
    return null;
  }

  return (
    <>
      <div className="hidden overflow-x-auto rounded-lg border border-border md:block">
        <table className="min-w-full border-collapse text-left text-sm">
          <thead className="bg-bg-subtle/50 text-xs uppercase tracking-wide text-fg-muted">
            <tr>
              <th className="px-3 py-2 font-medium">Token</th>
              <th className="px-3 py-2 font-medium">Role</th>
              <th className="px-3 py-2 font-medium">Device</th>
              <th className="px-3 py-2 font-medium">Access</th>
              <th className="px-3 py-2 font-medium">Expires</th>
              <th className="px-3 py-2 font-medium">Last changed</th>
              <th className="px-3 py-2 font-medium">Status</th>
              <th className="px-3 py-2 font-medium">Actions</th>
            </tr>
          </thead>
          <tbody>
            {visibleTokens.map((token) => (
              <tr
                key={token.token_id}
                data-testid={`admin-http-token-row-${token.token_id}`}
                className="border-t border-border align-top"
              >
                <td className="px-3 py-3">
                  <div className="font-medium text-fg">{token.display_name}</div>
                  <div className="font-mono text-xs text-fg-muted">{token.token_id}</div>
                </td>
                <td className="px-3 py-3">
                  <Badge>{token.role}</Badge>
                </td>
                <td className="px-3 py-3 text-fg-muted">{token.device_id ?? "Optional"}</td>
                <td className="px-3 py-3 text-fg-muted">{formatAccessSummary(token)}</td>
                <td className="px-3 py-3 text-fg-muted">{formatTimestamp(token.expires_at)}</td>
                <td className="px-3 py-3 text-fg-muted">{formatTimestamp(token.updated_at)}</td>
                <td className="px-3 py-3">
                  <Badge variant={statusBadgeVariant(token)}>{statusLabel(token)}</Badge>
                </td>
                <td className="px-3 py-3">
                  <div className="flex flex-wrap gap-2">
                    <TokenActionButton
                      canMutate={canMutate}
                      requestEnter={requestEnter}
                      testId={`admin-http-token-edit-${token.token_id}`}
                      variant="secondary"
                      disabled={Boolean(token.revoked_at)}
                      onClick={() => onEditToken(token)}
                    >
                      Edit
                    </TokenActionButton>
                    <TokenActionButton
                      canMutate={canMutate}
                      requestEnter={requestEnter}
                      testId={`admin-http-token-revoke-${token.token_id}`}
                      variant="danger"
                      disabled={Boolean(token.revoked_at)}
                      onClick={() => onRevokeToken(token)}
                    >
                      Revoke
                    </TokenActionButton>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="grid gap-3 md:hidden">
        {visibleTokens.map((token) => (
          <div
            key={token.token_id}
            data-testid={`admin-http-token-row-${token.token_id}`}
            className="grid gap-3 rounded-lg border border-border p-3"
          >
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="grid gap-1">
                <div className="font-medium text-fg">{token.display_name}</div>
                <div className="font-mono text-xs text-fg-muted">{token.token_id}</div>
              </div>
              <div className="flex flex-wrap gap-2">
                <Badge>{token.role}</Badge>
                <Badge variant={statusBadgeVariant(token)}>{statusLabel(token)}</Badge>
              </div>
            </div>

            <div className="grid gap-1 text-sm text-fg-muted">
              <div>
                <span className="font-medium text-fg">Device:</span> {token.device_id ?? "Optional"}
              </div>
              <div>
                <span className="font-medium text-fg">Access:</span> {formatAccessSummary(token)}
              </div>
              <div>
                <span className="font-medium text-fg">Expires:</span>{" "}
                {formatTimestamp(token.expires_at)}
              </div>
              <div>
                <span className="font-medium text-fg">Last changed:</span>{" "}
                {formatTimestamp(token.updated_at)}
              </div>
            </div>

            <div className="flex flex-wrap gap-2">
              <TokenActionButton
                canMutate={canMutate}
                requestEnter={requestEnter}
                testId={`admin-http-token-edit-${token.token_id}`}
                variant="secondary"
                disabled={Boolean(token.revoked_at)}
                onClick={() => onEditToken(token)}
              >
                Edit
              </TokenActionButton>
              <TokenActionButton
                canMutate={canMutate}
                requestEnter={requestEnter}
                testId={`admin-http-token-revoke-${token.token_id}`}
                variant="danger"
                disabled={Boolean(token.revoked_at)}
                onClick={() => onRevokeToken(token)}
              >
                Revoke
              </TokenActionButton>
            </div>
          </div>
        ))}
      </div>
    </>
  );
}

function TokenActionButton({
  canMutate,
  requestEnter,
  testId,
  variant,
  disabled,
  onClick,
  children,
}: {
  canMutate: boolean;
  requestEnter: () => void;
  testId: string;
  variant: "secondary" | "danger";
  disabled: boolean;
  onClick: () => void;
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <ElevatedModeTooltip canMutate={canMutate} requestEnter={requestEnter}>
      <Button
        size="sm"
        variant={variant}
        data-testid={testId}
        disabled={disabled}
        onClick={onClick}
      >
        {children}
      </Button>
    </ElevatedModeTooltip>
  );
}
