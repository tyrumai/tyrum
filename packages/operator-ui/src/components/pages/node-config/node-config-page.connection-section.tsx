import { toast } from "sonner";
import { Alert } from "../../ui/alert.js";
import { Button } from "../../ui/button.js";
import { Card, CardContent } from "../../ui/card.js";
import { Input } from "../../ui/input.js";
import { Switch } from "../../ui/switch.js";
import { useClipboard } from "../../../utils/clipboard.js";
import type { DesktopConnectionFields, NodeConnectionInfo } from "./node-config-page.types.js";

// ─── Readonly connection display (browser / mobile) ─────────────────────────

function ReadonlyConnectionContent({
  info,
}: {
  info: Extract<NodeConnectionInfo, { mode: "readonly" }>;
}) {
  return (
    <Card>
      <CardContent className="grid gap-4 pt-6">
        <div className="text-sm font-semibold text-fg">Gateway connection</div>

        {info.gatewayUrl ? (
          <div className="text-sm text-fg-muted">
            Gateway URL{" "}
            <span className="break-all font-mono text-xs text-fg">{info.gatewayUrl}</span>
          </div>
        ) : null}

        {info.platform ? (
          <div className="text-sm text-fg-muted">
            Platform <span className="font-medium text-fg">{info.platform}</span>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

// ─── Editable connection form (desktop) ─────────────────────────────────────

function EditableConnectionContent({ fields }: { fields: DesktopConnectionFields }) {
  const clipboard = useClipboard();

  const savedModeLabel = fields.connectionMode === "embedded" ? "Embedded" : "Remote";
  const currentTokenHelperText = fields.currentTokenLoading
    ? "Loading current gateway token…"
    : fields.currentTokenError
      ? undefined
      : fields.dirty && fields.currentToken
        ? `Visible token matches saved ${savedModeLabel} settings until you save changes.`
        : "Use this token to sign in to the gateway UI at /ui.";

  const copyCurrentToken = async (): Promise<void> => {
    const token = fields.currentToken ?? "";
    if (!token || !clipboard.canWrite) {
      toast.error("Failed to copy to clipboard");
      return;
    }

    try {
      await clipboard.writeText(token);
      toast.success("Copied to clipboard");
    } catch {
      toast.error("Failed to copy to clipboard");
    }
  };

  return (
    <Card>
      <CardContent className="grid gap-4 pt-6">
        <div className="text-sm font-semibold text-fg">Gateway connection</div>

        {/* Embedded / Remote toggle */}
        <div className="flex gap-2">
          <Button
            type="button"
            variant={fields.connectionMode === "embedded" ? "primary" : "secondary"}
            onClick={() => fields.onConnectionModeChange("embedded")}
          >
            Embedded
          </Button>
          <Button
            type="button"
            variant={fields.connectionMode === "remote" ? "primary" : "secondary"}
            onClick={() => fields.onConnectionModeChange("remote")}
          >
            Remote
          </Button>
        </div>

        {/* Current gateway token (always shown) */}
        <Input
          label="Current gateway token"
          type="text"
          readOnly
          spellCheck={false}
          autoCapitalize="none"
          autoCorrect="off"
          className="pr-20 font-mono text-xs"
          value={fields.currentToken ?? ""}
          placeholder={fields.currentTokenLoading ? "Loading current gateway token…" : undefined}
          helperText={currentTokenHelperText}
          suffix={
            <button
              type="button"
              aria-label="Copy gateway token"
              disabled={fields.currentTokenLoading || !fields.currentToken || !clipboard.canWrite}
              className="text-xs font-medium text-fg-muted enabled:hover:text-fg disabled:cursor-not-allowed disabled:opacity-50"
              onClick={() => {
                void copyCurrentToken();
              }}
            >
              Copy
            </button>
          }
        />

        {fields.currentTokenError ? (
          <Alert
            variant="error"
            title="Current token unavailable"
            description={fields.currentTokenError}
          />
        ) : null}

        {/* Mode-specific fields */}
        {fields.connectionMode === "embedded" ? (
          <Input
            label="Embedded gateway port"
            type="number"
            min={1024}
            max={65535}
            value={fields.port}
            onChange={(event) => fields.onPortChange(Number(event.target.value))}
          />
        ) : (
          <div className="grid gap-4">
            <Input
              label="Gateway WebSocket URL"
              type="text"
              value={fields.remoteUrl}
              onChange={(event) => fields.onRemoteUrlChange(event.target.value)}
              placeholder="wss://host:port/ws"
            />
            <Input
              label="Replace token"
              type="password"
              value={fields.remoteToken}
              onChange={(event) => fields.onRemoteTokenChange(event.target.value)}
              placeholder="Bearer token"
              helperText={
                fields.hasSavedRemoteToken && fields.remoteToken.trim() === ""
                  ? "Leave blank to keep the current saved token, or enter a new token to replace it."
                  : "Enter the token to save for remote mode."
              }
            />
            <Input
              label="TLS certificate fingerprint (SHA-256, optional)"
              type="text"
              value={fields.remoteTlsCertFingerprint256}
              onChange={(event) => fields.onRemoteTlsFingerprintChange(event.target.value)}
              placeholder="AA:BB:CC:…"
            />
            <div className="flex flex-wrap items-start justify-between gap-3 rounded-md border border-border bg-bg px-3 py-2">
              <div className="min-w-0 grid gap-0.5">
                <div className="text-sm font-medium text-fg">Allow self-signed TLS</div>
                <div className="text-xs text-fg-muted">
                  Requires a fingerprint; skips CA verification.
                </div>
              </div>
              <Switch
                className="shrink-0"
                checked={fields.remoteTlsAllowSelfSigned}
                onCheckedChange={fields.onRemoteTlsAllowSelfSignedChange}
              />
            </div>
          </div>
        )}

        {/* Background mode */}
        {fields.backgroundState ? (
          <div className="grid gap-3 rounded-md border border-border bg-bg px-3 py-3">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0 grid gap-0.5">
                <div className="text-sm font-medium text-fg">Background mode</div>
                <div className="text-xs text-fg-muted">
                  Keep Tyrum running in the tray/menu bar and launch at login when supported.
                </div>
              </div>
              <Switch
                className="shrink-0"
                checked={fields.backgroundState.enabled}
                disabled={fields.backgroundBusy}
                onCheckedChange={fields.onToggleBackgroundMode}
              />
            </div>
            <div className="text-xs text-fg-muted">
              {fields.backgroundState.enabled
                ? fields.backgroundState.loginAutoStartActive
                  ? "Launch at login is active."
                  : fields.connectionMode === "embedded"
                    ? "Background mode is enabled, but launch at login is not active on this platform right now."
                    : "Background mode is saved and will activate when Embedded mode is active."
                : "Background mode is disabled."}
            </div>
            <div className="text-xs text-fg-muted">
              Tray/menu-bar access:{" "}
              {fields.backgroundState.trayAvailable ? "available" : "unavailable"}.
            </div>
          </div>
        ) : null}

        {fields.backgroundError ? (
          <Alert
            variant="error"
            title="Background mode error"
            description={fields.backgroundError}
          />
        ) : null}

        {/* Save button */}
        <div className="grid gap-3">
          <Button
            type="button"
            isLoading={fields.saving}
            disabled={!fields.dirty || fields.saving}
            onClick={fields.onSave}
          >
            {fields.saving ? "Saving…" : fields.saved ? "Saved!" : "Save connection settings"}
          </Button>
          {fields.saveError ? (
            <Alert variant="error" title="Save failed" description={fields.saveError} />
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}

// ─── ConnectionSection (public API) ─────────────────────────────────────────

export interface ConnectionSectionProps {
  connection: NodeConnectionInfo;
}

export function ConnectionSection({ connection }: ConnectionSectionProps) {
  if (connection.mode === "readonly") {
    return <ReadonlyConnectionContent info={connection} />;
  }

  return <EditableConnectionContent fields={connection.editable} />;
}
