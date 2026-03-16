import type { OperatorCore } from "@tyrum/operator-core";
import type { AuthTokenListEntry, AuthTokenUpdateInput } from "@tyrum/client/browser";
import * as React from "react";
import { Alert } from "../ui/alert.js";
import { type BadgeVariant } from "../ui/badge.js";
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
import { Input } from "../ui/input.js";
import { Select } from "../ui/select.js";

export type TokenRole = "admin" | "client" | "node";
export type TokenStatusFilter = "all" | "active" | "expired" | "revoked";
export type ScopePresetKey =
  | "read_only"
  | "operator"
  | "approvals"
  | "pairing"
  | "full_admin"
  | "custom";
export type ExpirationPresetKey = "never" | "1h" | "24h" | "7d" | "30d" | "90d" | "custom";
export type DialogMode = "create" | "edit";
export type AuthTokenIssueResult = Awaited<ReturnType<OperatorCore["http"]["authTokens"]["issue"]>>;

export const SCOPE_OPTIONS = [
  { value: "operator.read", label: "Read" },
  { value: "operator.write", label: "Write" },
  { value: "operator.approvals", label: "Approvals" },
  { value: "operator.pairing", label: "Pairing" },
  { value: "operator.admin", label: "Admin" },
] as const;

export const SCOPE_PRESETS: ReadonlyArray<{
  key: ScopePresetKey;
  label: string;
  scopes: readonly string[];
}> = [
  { key: "read_only", label: "Read only", scopes: ["operator.read"] },
  { key: "operator", label: "Standard", scopes: ["operator.read", "operator.write"] },
  { key: "approvals", label: "Approvals", scopes: ["operator.read", "operator.approvals"] },
  { key: "pairing", label: "Pairing", scopes: ["operator.read", "operator.pairing"] },
  {
    key: "full_admin",
    label: "Full admin",
    scopes: [
      "operator.read",
      "operator.write",
      "operator.approvals",
      "operator.pairing",
      "operator.admin",
    ],
  },
] as const;

const EXPIRATION_PRESETS: ReadonlyArray<{
  key: Exclude<ExpirationPresetKey, "custom" | "never">;
  label: string;
  seconds: number;
}> = [
  { key: "1h", label: "1 hour", seconds: 60 * 60 },
  { key: "24h", label: "24 hours", seconds: 60 * 60 * 24 },
  { key: "7d", label: "7 days", seconds: 60 * 60 * 24 * 7 },
  { key: "30d", label: "30 days", seconds: 60 * 60 * 24 * 30 },
  { key: "90d", label: "90 days", seconds: 60 * 60 * 24 * 90 },
] as const;

export type TokenFormState = {
  displayName: string;
  role: TokenRole;
  deviceId: string;
  scopePreset: ScopePresetKey;
  selectedScopes: string[];
  expirationPreset: ExpirationPresetKey;
  customExpiresAt: string;
};

export function uniqueScopes(scopes: readonly string[]): string[] {
  return Array.from(new Set(scopes.map((scope) => scope.trim()).filter(Boolean)));
}

function sortScopes(scopes: readonly string[]): string[] {
  return uniqueScopes(scopes).toSorted((left, right) => left.localeCompare(right));
}

function scopesEqual(left: readonly string[], right: readonly string[]): boolean {
  const leftSorted = sortScopes(left);
  const rightSorted = sortScopes(right);
  return (
    leftSorted.length === rightSorted.length &&
    leftSorted.every((scope, index) => scope === rightSorted[index])
  );
}

export function resolveScopePreset(scopes: readonly string[]): ScopePresetKey {
  for (const preset of SCOPE_PRESETS) {
    if (scopesEqual(scopes, preset.scopes)) return preset.key;
  }
  return "custom";
}

export function presetScopes(key: ScopePresetKey): string[] {
  return [...(SCOPE_PRESETS.find((preset) => preset.key === key)?.scopes ?? [])];
}

export function formatTimestamp(value: string | null | undefined): string {
  if (!value) return "Never";
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return value;
  return new Date(parsed).toLocaleString();
}

function toDateTimeLocalValue(value: string | null | undefined): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const pad = (part: number) => String(part).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(
    date.getHours(),
  )}:${pad(date.getMinutes())}`;
}

function parseDateTimeLocalValue(value: string): string | undefined {
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  const parsed = Date.parse(trimmed);
  if (!Number.isFinite(parsed)) return undefined;
  return new Date(parsed).toISOString();
}

function isExpiredToken(token: AuthTokenListEntry): boolean {
  if (token.revoked_at || !token.expires_at) return false;
  const expiresAtMs = Date.parse(token.expires_at);
  return Number.isFinite(expiresAtMs) && expiresAtMs <= Date.now();
}

export function tokenStatus(token: AuthTokenListEntry): Exclude<TokenStatusFilter, "all"> {
  if (token.revoked_at) return "revoked";
  if (isExpiredToken(token)) return "expired";
  return "active";
}

export function statusBadgeVariant(token: AuthTokenListEntry): BadgeVariant {
  const status = tokenStatus(token);
  if (status === "active") return "success";
  if (status === "expired") return "warning";
  return "outline";
}

export function statusLabel(token: AuthTokenListEntry): string {
  const status = tokenStatus(token);
  if (status === "active") return "Active";
  if (status === "expired") return "Expired";
  return "Revoked";
}

function statusSortOrder(token: AuthTokenListEntry): number {
  const status = tokenStatus(token);
  if (status === "active") return 0;
  if (status === "expired") return 1;
  return 2;
}

function matchingExpirationPreset(expiresAt: string | null): ExpirationPresetKey {
  if (!expiresAt) return "never";
  const expiresAtMs = Date.parse(expiresAt);
  if (!Number.isFinite(expiresAtMs)) return "custom";
  const diffSeconds = Math.round((expiresAtMs - Date.now()) / 1000);
  if (diffSeconds <= 0) return "custom";
  for (const preset of EXPIRATION_PRESETS) {
    if (Math.abs(diffSeconds - preset.seconds) <= 60) {
      return preset.key;
    }
  }
  return "custom";
}

function expirationSeconds(key: Exclude<ExpirationPresetKey, "never" | "custom">): number {
  return EXPIRATION_PRESETS.find((preset) => preset.key === key)?.seconds ?? 0;
}

export function formatAccessSummary(token: AuthTokenListEntry): string {
  if (token.role === "admin") return "Admin access";
  const preset = SCOPE_PRESETS.find((entry) => scopesEqual(token.scopes, entry.scopes));
  if (preset) return preset.label;
  if (token.scopes.length === 0) return "No scopes";
  return token.scopes.join(", ");
}

export function matchesQuery(token: AuthTokenListEntry, query: string): boolean {
  if (!query) return true;
  const normalized = query.toLowerCase();
  return [
    token.display_name,
    token.token_id,
    token.device_id ?? "",
    token.role,
    ...token.scopes,
  ].some((value) => value.toLowerCase().includes(normalized));
}

export function sortVisibleTokens(tokens: AuthTokenListEntry[]): AuthTokenListEntry[] {
  return tokens.toSorted((left, right) => {
    const statusOrder = statusSortOrder(left) - statusSortOrder(right);
    if (statusOrder !== 0) return statusOrder;
    return Date.parse(right.updated_at) - Date.parse(left.updated_at);
  });
}

export function defaultFormState(): TokenFormState {
  return {
    displayName: "",
    role: "client",
    deviceId: "tyrum",
    scopePreset: "read_only",
    selectedScopes: presetScopes("read_only"),
    expirationPreset: "24h",
    customExpiresAt: "",
  };
}

export function formStateFromToken(token: AuthTokenListEntry): TokenFormState {
  const scopePreset = token.role === "admin" ? "full_admin" : resolveScopePreset(token.scopes);
  return {
    displayName: token.display_name,
    role: token.role,
    deviceId: token.device_id ?? "",
    scopePreset,
    selectedScopes:
      token.role === "admin" ? presetScopes("full_admin") : uniqueScopes(token.scopes),
    expirationPreset: matchingExpirationPreset(token.expires_at),
    customExpiresAt: toDateTimeLocalValue(token.expires_at),
  };
}

export function validateForm(
  state: TokenFormState,
  options?: { initialExpiresAt?: string | null },
): string | null {
  if (!state.displayName.trim()) return "Name is required.";
  if (state.role !== "admin" && !state.deviceId.trim()) {
    return "Device ID is required for client and node tokens.";
  }
  if (state.expirationPreset === "custom") {
    const expiresAt = parseDateTimeLocalValue(state.customExpiresAt);
    if (!expiresAt) return "Choose a valid expiration date and time.";
    if (Date.parse(expiresAt) <= Date.now()) {
      // Editing an existing token should allow preserving its current expiration, even if it is
      // already in the past, so metadata-only edits still work for expired tokens.
      if (
        options?.initialExpiresAt &&
        state.customExpiresAt === toDateTimeLocalValue(options.initialExpiresAt)
      ) {
        return null;
      }
      return "Expiration must be in the future.";
    }
  }
  return null;
}

export function buildIssueInput(state: TokenFormState) {
  const input: Parameters<OperatorCore["http"]["authTokens"]["issue"]>[0] = {
    display_name: state.displayName.trim(),
    role: state.role,
    scopes: state.role === "admin" ? [] : uniqueScopes(state.selectedScopes),
  };
  if (state.role !== "admin" || state.deviceId.trim()) {
    input.device_id = state.deviceId.trim();
  }
  if (state.expirationPreset === "custom") {
    const expiresAt = parseDateTimeLocalValue(state.customExpiresAt);
    if (expiresAt) {
      input.ttl_seconds = Math.max(1, Math.ceil((Date.parse(expiresAt) - Date.now()) / 1000));
    }
  } else if (state.expirationPreset !== "never") {
    input.ttl_seconds = expirationSeconds(state.expirationPreset);
  }
  return input;
}

function isExpirationUnchanged(
  state: TokenFormState,
  options?: {
    initialExpiresAt?: string | null;
    initialExpirationPreset?: ExpirationPresetKey;
    initialCustomExpiresAt?: string;
  },
): boolean {
  const initialExpirationPreset =
    options?.initialExpirationPreset ?? matchingExpirationPreset(options?.initialExpiresAt ?? null);
  const initialCustomExpiresAt =
    options?.initialCustomExpiresAt ?? toDateTimeLocalValue(options?.initialExpiresAt);
  return (
    state.expirationPreset === initialExpirationPreset &&
    state.customExpiresAt === initialCustomExpiresAt
  );
}

export function buildUpdateInput(
  state: TokenFormState,
  options?: {
    initialExpiresAt?: string | null;
    initialExpirationPreset?: ExpirationPresetKey;
    initialCustomExpiresAt?: string;
  },
): AuthTokenUpdateInput {
  const input: AuthTokenUpdateInput = {
    display_name: state.displayName.trim(),
    role: state.role,
    device_id: state.deviceId.trim() ? state.deviceId.trim() : null,
    scopes: state.role === "admin" ? [] : uniqueScopes(state.selectedScopes),
  };
  if (isExpirationUnchanged(state, options)) return input;
  if (state.expirationPreset === "custom") {
    input.expires_at = parseDateTimeLocalValue(state.customExpiresAt) ?? null;
  } else if (state.expirationPreset === "never") {
    input.expires_at = null;
  } else {
    input.expires_at = new Date(
      Date.now() + expirationSeconds(state.expirationPreset) * 1000,
    ).toISOString();
  }
  return input;
}

export function TokenDialog({
  open,
  mode,
  state,
  errorMessage,
  saving,
  onOpenChange,
  onStateChange,
  onSave,
}: {
  open: boolean;
  mode: DialogMode;
  state: TokenFormState;
  errorMessage: string | null;
  saving: boolean;
  onOpenChange: (open: boolean) => void;
  onStateChange: React.Dispatch<React.SetStateAction<TokenFormState>>;
  onSave: () => void;
}): React.ReactElement {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-testid="admin-http-token-dialog">
        <DialogHeader>
          <DialogTitle>{mode === "create" ? "Add token" : "Edit token"}</DialogTitle>
          <DialogDescription>
            {mode === "create"
              ? "Create a tenant token with a clear name, explicit access, and structured expiration."
              : "Update token metadata and access without rotating the secret."}
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4">
          {errorMessage ? (
            <Alert variant="error" title="Unable to save token" description={errorMessage} />
          ) : null}

          <Input
            label="Name"
            required
            maxLength={120}
            value={state.displayName}
            onChange={(event) =>
              onStateChange((current) => ({ ...current, displayName: event.currentTarget.value }))
            }
          />

          <div className="grid gap-3 sm:grid-cols-2">
            <Select
              label="Role"
              value={state.role}
              onChange={(event) => {
                const role = event.currentTarget.value as TokenRole;
                onStateChange((current) => ({
                  ...current,
                  role,
                  selectedScopes:
                    role === "admin" ? presetScopes("full_admin") : current.selectedScopes,
                  scopePreset:
                    role === "admin" ? "full_admin" : resolveScopePreset(current.selectedScopes),
                }));
              }}
            >
              <option value="admin">Admin</option>
              <option value="client">Client</option>
              <option value="node">Node</option>
            </Select>

            <Input
              label="Device ID"
              required={state.role !== "admin"}
              value={state.deviceId}
              placeholder={state.role === "admin" ? "Optional" : "device-123"}
              helperText={
                state.role === "admin"
                  ? "Optional for admin tokens."
                  : "Required for client and node tokens."
              }
              onChange={(event) =>
                onStateChange((current) => ({ ...current, deviceId: event.currentTarget.value }))
              }
            />
          </div>

          {state.role === "admin" ? (
            <Alert
              variant="info"
              title="Admin tokens bypass scoped operator permissions"
              description="Role admin is treated as break-glass access, so no scope checklist is shown."
            />
          ) : (
            <div className="grid gap-3 rounded-lg border border-border p-3">
              <Select
                label="Access preset"
                value={state.scopePreset}
                onChange={(event) => {
                  const preset = event.currentTarget.value as ScopePresetKey;
                  onStateChange((current) => ({
                    ...current,
                    scopePreset: preset,
                    selectedScopes:
                      preset === "custom" ? current.selectedScopes : presetScopes(preset),
                  }));
                }}
              >
                {SCOPE_PRESETS.map((preset) => (
                  <option key={preset.key} value={preset.key}>
                    {preset.label}
                  </option>
                ))}
                <option value="custom">Custom</option>
              </Select>

              <div className="grid gap-2">
                <div className="text-sm font-medium text-fg">Scopes</div>
                <div className="grid gap-2 sm:grid-cols-2">
                  {SCOPE_OPTIONS.map((scope) => {
                    const checked = state.selectedScopes.includes(scope.value);
                    return (
                      <label
                        key={scope.value}
                        className="flex items-center gap-2 rounded-lg border border-border/60 p-2 text-sm text-fg"
                      >
                        <Checkbox
                          checked={checked}
                          onCheckedChange={(nextChecked) => {
                            onStateChange((current) => {
                              const nextScopes = nextChecked
                                ? uniqueScopes([...current.selectedScopes, scope.value])
                                : current.selectedScopes.filter((entry) => entry !== scope.value);
                              return {
                                ...current,
                                selectedScopes: nextScopes,
                                scopePreset: resolveScopePreset(nextScopes),
                              };
                            });
                          }}
                        />
                        <span>{scope.label}</span>
                      </label>
                    );
                  })}
                </div>
              </div>
            </div>
          )}

          <div className="grid gap-3 rounded-lg border border-border p-3">
            <Select
              label="Expiration"
              value={state.expirationPreset}
              onChange={(event) => {
                const expirationPreset = event.currentTarget.value as ExpirationPresetKey;
                onStateChange((current) => ({ ...current, expirationPreset }));
              }}
            >
              <option value="never">Never</option>
              {EXPIRATION_PRESETS.map((preset) => (
                <option key={preset.key} value={preset.key}>
                  {preset.label}
                </option>
              ))}
              <option value="custom">Custom date/time</option>
            </Select>

            {state.expirationPreset === "custom" ? (
              <Input
                label="Custom expiration"
                type="datetime-local"
                value={state.customExpiresAt}
                onChange={(event) =>
                  onStateChange((current) => ({
                    ...current,
                    customExpiresAt: event.currentTarget.value,
                  }))
                }
              />
            ) : null}
          </div>
        </div>

        <DialogFooter>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            data-testid="admin-http-token-dialog-save"
            isLoading={saving}
            onClick={() => onSave()}
          >
            {mode === "create" ? "Create token" : "Save changes"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
