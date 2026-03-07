import type { DesktopBackgroundState } from "../../desktop-api.js";
import { Alert } from "../ui/alert.js";
import { Badge } from "../ui/badge.js";
import { Button } from "../ui/button.js";
import { Card, CardContent } from "../ui/card.js";
import { Input } from "../ui/input.js";
import { Label } from "../ui/label.js";
import { RadioGroup, RadioGroupItem } from "../ui/radio-group.js";
import { Switch } from "../ui/switch.js";
import { Textarea } from "../ui/textarea.js";
import {
  PROFILE_OPTIONS,
  type ConnectionState,
  type DisplayProfile,
} from "./node-configure-page.shared.js";

export function SecurityProfileCard({
  profile,
  onProfileChange,
}: {
  profile: DisplayProfile;
  onProfileChange: (profile: DisplayProfile) => void;
}) {
  return (
    <Card>
      <CardContent className="grid gap-4 pt-6">
        <div className="text-sm font-semibold text-fg">Security profile</div>
        <RadioGroup
          value={profile}
          onValueChange={(value) => onProfileChange(value as DisplayProfile)}
        >
          {PROFILE_OPTIONS.map((option) => (
            <div
              key={option.id}
              className={[
                "flex items-start gap-3 rounded-md border p-3",
                profile === option.id
                  ? "border-primary bg-primary-dim"
                  : "border-border bg-bg-card",
                option.disabled ? "opacity-80" : "",
              ].join(" ")}
            >
              <RadioGroupItem
                id={`node-profile-${option.id}`}
                value={option.id}
                disabled={option.disabled}
              />
              <div className="grid gap-1">
                <Label
                  htmlFor={`node-profile-${option.id}`}
                  className="text-sm font-medium text-fg"
                >
                  {option.label}
                </Label>
                <div className="text-sm text-fg-muted">{option.description}</div>
              </div>
            </div>
          ))}
        </RadioGroup>
      </CardContent>
    </Card>
  );
}

export function NodeConnectionCard(props: {
  connection: ConnectionState;
  backgroundState: DesktopBackgroundState | null;
  backgroundBusy: boolean;
  backgroundError: string | null;
  onModeChange: (mode: ConnectionState["mode"]) => void;
  onPortChange: (port: number) => void;
  onRemoteUrlChange: (value: string) => void;
  onRemoteTokenChange: (value: string) => void;
  onRemoteTlsFingerprintChange: (value: string) => void;
  onRemoteTlsAllowSelfSignedChange: (value: boolean) => void;
  onToggleBackgroundMode: (enabled: boolean) => void;
}) {
  return (
    <Card>
      <CardContent className="grid gap-4 pt-6">
        <div className="text-sm font-semibold text-fg">Gateway connection</div>
        <div className="flex gap-2">
          <Button
            type="button"
            variant={props.connection.mode === "embedded" ? "primary" : "secondary"}
            onClick={() => props.onModeChange("embedded")}
          >
            Embedded
          </Button>
          <Button
            type="button"
            variant={props.connection.mode === "remote" ? "primary" : "secondary"}
            onClick={() => props.onModeChange("remote")}
          >
            Remote
          </Button>
        </div>

        {props.connection.mode === "embedded" ? (
          <Input
            label="Embedded gateway port"
            type="number"
            min={1024}
            max={65535}
            value={props.connection.port}
            onChange={(event) => props.onPortChange(Number(event.target.value))}
          />
        ) : (
          <div className="grid gap-4">
            <Input
              label="Gateway WebSocket URL"
              type="text"
              value={props.connection.remoteUrl}
              onChange={(event) => props.onRemoteUrlChange(event.target.value)}
              placeholder="wss://host:port/ws"
            />
            <Input
              label="Token"
              type="password"
              value={props.connection.remoteToken}
              onChange={(event) => props.onRemoteTokenChange(event.target.value)}
              placeholder="Bearer token"
              helperText={
                props.connection.hasSavedRemoteToken && props.connection.remoteToken.trim() === ""
                  ? "A token is already saved. Leave blank to reuse it, or enter a new token to replace it."
                  : undefined
              }
            />
            <Input
              label="TLS certificate fingerprint (SHA-256, optional)"
              type="text"
              value={props.connection.remoteTlsCertFingerprint256}
              onChange={(event) => props.onRemoteTlsFingerprintChange(event.target.value)}
              placeholder="AA:BB:CC:…"
            />
            <div className="flex items-center justify-between gap-3 rounded-md border border-border bg-bg-card/40 px-3 py-2">
              <div className="grid gap-0.5">
                <div className="text-sm font-medium text-fg">Allow self-signed TLS</div>
                <div className="text-xs text-fg-muted">
                  Requires a fingerprint; skips CA verification.
                </div>
              </div>
              <Switch
                checked={props.connection.remoteTlsAllowSelfSigned}
                onCheckedChange={props.onRemoteTlsAllowSelfSignedChange}
              />
            </div>
          </div>
        )}

        {props.backgroundState ? (
          <div className="grid gap-3 rounded-md border border-border bg-bg-card/40 px-3 py-3">
            <div className="flex items-center justify-between gap-3">
              <div className="grid gap-0.5">
                <div className="text-sm font-medium text-fg">Background mode</div>
                <div className="text-xs text-fg-muted">
                  Keep Tyrum running in the tray/menu bar and launch at login when supported.
                </div>
              </div>
              <Switch
                checked={props.backgroundState.enabled}
                disabled={props.backgroundBusy}
                onCheckedChange={props.onToggleBackgroundMode}
              />
            </div>
            <div className="text-xs text-fg-muted">
              {props.backgroundState.enabled
                ? props.backgroundState.loginAutoStartActive
                  ? "Launch at login is active."
                  : props.connection.mode === "embedded"
                    ? "Background mode is enabled, but launch at login is not active on this platform right now."
                    : "Background mode is saved and will activate when Embedded mode is active."
                : "Background mode is disabled."}
            </div>
            <div className="text-xs text-fg-muted">
              Tray/menu-bar access:{" "}
              {props.backgroundState.trayAvailable ? "available" : "unavailable"}.
            </div>
          </div>
        ) : null}

        {props.backgroundError ? (
          <Alert
            variant="error"
            title="Background mode error"
            description={props.backgroundError}
          />
        ) : null}
      </CardContent>
    </Card>
  );
}

export function CapabilityCard(props: {
  title: string;
  capabilityTestId: string;
  description: string;
  enabled: boolean;
  onEnabledChange: (enabled: boolean) => void;
}) {
  return (
    <Card>
      <CardContent className="grid gap-4 pt-6">
        <div className="flex items-center justify-between gap-4 border-b border-border py-2">
          <div>
            <div className="text-sm font-semibold text-fg">{props.title}</div>
            <div className="text-sm text-fg-muted">{props.description}</div>
          </div>
          <Switch
            data-testid={props.capabilityTestId}
            checked={props.enabled}
            onCheckedChange={props.onEnabledChange}
          />
        </div>
      </CardContent>
    </Card>
  );
}

export function AllowlistCard(props: {
  title: string;
  active: boolean;
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  notes: string[];
  warningTitle?: string;
  warningDescription?: string;
  showWarning?: boolean;
}) {
  return (
    <Card>
      <CardContent className="grid gap-4 pt-6">
        <AllowlistHeader title={props.title} active={props.active} />
        <Textarea
          label={`${props.title} (one per line)`}
          value={props.value}
          disabled={!props.active}
          onChange={(event) => props.onChange(event.target.value)}
          placeholder={props.placeholder}
        />
        <FieldNotes notes={props.notes} />
        {props.showWarning && props.warningTitle && props.warningDescription ? (
          <Alert
            variant="warning"
            title={props.warningTitle}
            description={props.warningDescription}
          />
        ) : null}
      </CardContent>
    </Card>
  );
}

export function MacPermissionsCard(props: {
  apiAvailable: boolean;
  summary: string | null;
  checking: boolean;
  requestingPermission: "accessibility" | "screenRecording" | null;
  errorMessage: string | null;
  onCheck: () => void;
  onRequest: (permission: "accessibility" | "screenRecording") => void;
}) {
  return (
    <Card>
      <CardContent className="grid gap-4 pt-6">
        <div className="text-sm font-semibold text-fg">macOS permissions</div>
        <div className="text-sm text-fg-muted">
          Desktop automation may require Accessibility and Screen Recording permissions on macOS.
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            data-testid="node-check-mac-permissions"
            variant="secondary"
            disabled={!props.apiAvailable || props.checking || props.requestingPermission !== null}
            isLoading={props.checking}
            onClick={props.onCheck}
          >
            {props.checking ? "Checking..." : "Check permissions"}
          </Button>
          <Button
            type="button"
            data-testid="node-request-accessibility"
            variant="secondary"
            disabled={!props.apiAvailable || props.requestingPermission !== null}
            isLoading={props.requestingPermission === "accessibility"}
            onClick={() => props.onRequest("accessibility")}
          >
            {props.requestingPermission === "accessibility"
              ? "Requesting..."
              : "Request Accessibility"}
          </Button>
          <Button
            type="button"
            data-testid="node-request-screen-recording"
            variant="secondary"
            disabled={!props.apiAvailable || props.requestingPermission !== null}
            isLoading={props.requestingPermission === "screenRecording"}
            onClick={() => props.onRequest("screenRecording")}
          >
            {props.requestingPermission === "screenRecording"
              ? "Opening..."
              : "Request Screen Recording"}
          </Button>
        </div>
        {props.summary ? <div className="text-sm text-fg">{props.summary}</div> : null}
        {props.errorMessage ? (
          <Alert
            variant="error"
            title="Permission request failed"
            description={props.errorMessage}
          />
        ) : null}
      </CardContent>
    </Card>
  );
}

export function SaveActions(props: {
  buttonLabel: string;
  testId: string;
  isLoading: boolean;
  saved: boolean;
  disabled: boolean;
  errorMessage: string | null;
  onSave: () => void;
}) {
  return (
    <div className="grid gap-3">
      <Button
        type="button"
        data-testid={props.testId}
        isLoading={props.isLoading}
        disabled={props.disabled || props.isLoading}
        onClick={props.onSave}
      >
        {props.isLoading ? "Saving..." : props.saved ? "Saved!" : props.buttonLabel}
      </Button>
      {props.errorMessage ? (
        <Alert variant="error" title="Save failed" description={props.errorMessage} />
      ) : null}
    </div>
  );
}

function AllowlistHeader(props: { title: string; active: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <div className="text-sm font-semibold text-fg">{props.title}</div>
      <Badge variant={props.active ? "danger" : "success"}>
        {props.active ? "active (default deny)" : "inactive (default allow)"}
      </Badge>
    </div>
  );
}

function FieldNotes({ notes }: { notes: string[] }) {
  return (
    <div className="grid gap-1 text-sm text-fg-muted">
      {notes.map((note) => (
        <div key={note}>{note}</div>
      ))}
    </div>
  );
}
