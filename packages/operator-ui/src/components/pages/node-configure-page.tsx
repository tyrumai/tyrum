import { useEffect, useMemo, useRef, useState } from "react";
import type { DesktopApi, DesktopBackgroundState } from "../../desktop-api.js";
import { useHostApi } from "../../host/host-api.js";
import { formatErrorMessage } from "../../utils/format-error-message.js";
import {
  capabilitiesForProfile,
  getAllowlistMode,
  type CapFlags,
  type Profile,
} from "../../utils/permission-profile.js";
import { Alert } from "../ui/alert.js";
import { Badge } from "../ui/badge.js";
import { Button } from "../ui/button.js";
import { Card, CardContent } from "../ui/card.js";
import { Input } from "../ui/input.js";
import { Label } from "../ui/label.js";
import { RadioGroup, RadioGroupItem } from "../ui/radio-group.js";
import { Switch } from "../ui/switch.js";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../ui/tabs.js";
import { Textarea } from "../ui/textarea.js";

type ConfigureTab = "general" | "desktop" | "browser" | "shell" | "web";
type DisplayProfile = Profile | "custom";

interface CliConfig {
  allowedCommands: string[];
  allowedWorkingDirs: string[];
}

interface WebConfig {
  allowedDomains: string[];
  headless: boolean;
}

interface AllowlistDraftState {
  browserDomains: string;
  cliCommands: string;
  cliWorkingDirs: string;
}

interface SaveResetTimers {
  general: ReturnType<typeof setTimeout> | null;
  security: ReturnType<typeof setTimeout> | null;
}

interface SecurityState {
  profile: Profile;
  overrides: Record<string, boolean>;
  capabilities: CapFlags;
  cli: CliConfig;
  web: WebConfig;
}

interface ConnectionState {
  mode: "embedded" | "remote";
  port: number;
  remoteUrl: string;
  remoteToken: string;
  remoteTlsCertFingerprint256: string;
  remoteTlsAllowSelfSigned: boolean;
  hasSavedRemoteToken: boolean;
}

interface MacPermissionSnapshot {
  accessibility: boolean | null;
  screenRecording: boolean | null;
  instructions?: string;
}

const DEFAULT_PROFILE: Profile = "balanced";
// Preserve the historical restrictive fallback until the stored config provides capabilities.
const DEFAULT_CAPABILITIES = capabilitiesForProfile("safe");
const DEFAULT_CLI_CONFIG: CliConfig = { allowedCommands: [], allowedWorkingDirs: [] };
const DEFAULT_WEB_CONFIG: WebConfig = { allowedDomains: [], headless: true };

const PROFILE_OPTIONS: Array<{
  id: DisplayProfile;
  label: string;
  description: string;
  disabled?: boolean;
}> = [
  {
    id: "safe",
    label: "Safe",
    description:
      "Screenshot only. No input control, shell, browser, or web access. Best default for untrusted workloads.",
  },
  {
    id: "balanced",
    label: "Balanced",
    description:
      "Desktop, browser, shell, and web capabilities available with restrictive defaults. Recommended for most users.",
  },
  {
    id: "poweruser",
    label: "Power user",
    description:
      "Full local-node access with fewer restrictions. Use only when you trust the workloads and environment.",
  },
  {
    id: "custom",
    label: "Custom",
    description:
      "Selected automatically when your node settings differ from a preset. Choose a preset to reset back to a standard profile.",
    disabled: true,
  },
];

const SHELL_COMMAND_NOTES = [
  "- Use one rule per line.",
  "- `*` allows all commands.",
  "- Subcommand rules are prefix matches. `git status` allows `git status -sb`, but not `git push`.",
  "- A bare command such as `git` allows all its subcommands.",
];
const SHELL_DIRECTORY_NOTES = [
  "- Use one directory per line.",
  "- `*` allows any working directory when the allowlist is active.",
];
const BROWSER_DOMAIN_NOTES = [
  "- Use one domain per line.",
  "- Subdomains are allowed automatically.",
  "- `*` allows all domains.",
];

export function NodeConfigurePage({ onReloadPage }: { onReloadPage?: () => void }) {
  const host = useHostApi();
  if (host.kind !== "desktop") {
    return (
      <div className="grid gap-6">
        <h1 className="text-2xl font-semibold tracking-tight text-fg">Node Configuration</h1>
        <Alert
          variant="warning"
          title="Not available"
          description="Node configuration is only available in the desktop app."
        />
      </div>
    );
  }

  const api = host.api;
  if (!api) {
    return (
      <div className="grid gap-6">
        <h1 className="text-2xl font-semibold tracking-tight text-fg">Node Configuration</h1>
        <Alert variant="error" title="Desktop API not available." />
      </div>
    );
  }

  return <DesktopNodeConfigurePage api={api} onReloadPage={onReloadPage} />;
}

function DesktopNodeConfigurePage({
  api,
  onReloadPage,
}: {
  api: DesktopApi;
  onReloadPage?: () => void;
}) {
  const [tab, setTab] = useState<ConfigureTab>("general");
  const model = useDesktopNodeConfigureModel(api, onReloadPage);
  const saveBusy = model.generalSaving || model.securitySaving;

  if (model.loading) {
    return (
      <div className="grid gap-6">
        <h1 className="text-2xl font-semibold tracking-tight text-fg">Node Configuration</h1>
        <Card>
          <CardContent className="grid gap-2 pt-6 text-sm text-fg-muted">
            <div>Loading node settings…</div>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (model.loadError) {
    return (
      <div className="grid gap-6">
        <h1 className="text-2xl font-semibold tracking-tight text-fg">Node Configuration</h1>
        <Alert variant="error" title="Failed to load node settings" description={model.loadError} />
      </div>
    );
  }

  return (
    <div className="grid gap-6">
      <div className="grid gap-1">
        <h1 className="text-2xl font-semibold tracking-tight text-fg">Node Configuration</h1>
        <div className="text-sm text-fg-muted">
          Configure the local node runtime used by Tyrum Desktop.
        </div>
      </div>

      <Tabs value={tab} onValueChange={(value) => setTab(value as ConfigureTab)}>
        <TabsList>
          <TabsTrigger value="general">General</TabsTrigger>
          <TabsTrigger value="desktop">Desktop</TabsTrigger>
          <TabsTrigger value="browser">Browser</TabsTrigger>
          <TabsTrigger value="shell">Shell</TabsTrigger>
          <TabsTrigger value="web">Web</TabsTrigger>
        </TabsList>

        <TabsContent value="general" className="grid gap-6">
          <SecurityProfileCard
            profile={model.displayProfile}
            onProfileChange={model.applyProfile}
          />
          <NodeConnectionCard
            connection={model.connection}
            backgroundState={model.backgroundState}
            backgroundBusy={model.backgroundBusy}
            backgroundError={model.backgroundError}
            onModeChange={model.setMode}
            onPortChange={model.setPort}
            onRemoteUrlChange={model.setRemoteUrl}
            onRemoteTokenChange={model.setRemoteToken}
            onRemoteTlsFingerprintChange={model.setRemoteTlsCertFingerprint256}
            onRemoteTlsAllowSelfSignedChange={model.setRemoteTlsAllowSelfSigned}
            onToggleBackgroundMode={model.toggleBackgroundMode}
          />
          <SaveActions
            buttonLabel="Save General Settings"
            testId="node-configure-save-general"
            isLoading={model.generalSaving}
            saved={model.generalSaved}
            disabled={saveBusy || (!model.generalDirty && !model.securityDirty)}
            errorMessage={model.generalError}
            onSave={model.saveGeneral}
          />
        </TabsContent>

        <TabsContent value="desktop" className="grid gap-6">
          <CapabilityCard
            title="Desktop"
            capabilityTestId="node-capability-desktop"
            description="Enable local desktop automation capabilities such as screenshots and input."
            enabled={model.security.capabilities.desktop}
            onEnabledChange={(next) => model.setCapability("desktop", next)}
          />
          <MacPermissionsCard
            apiAvailable={Boolean(api.checkMacPermissions)}
            summary={model.macPermissionSummary}
            checking={model.macPermissionChecking}
            requestingPermission={model.requestingMacPermission}
            errorMessage={model.macPermissionError}
            onCheck={model.checkMacPermissions}
            onRequest={model.requestMacPermission}
          />
          <SaveActions
            buttonLabel="Save Node Settings"
            testId="node-configure-save-security"
            isLoading={model.securitySaving}
            saved={model.securitySaved}
            disabled={saveBusy || !model.securityDirty}
            errorMessage={model.securityError}
            onSave={model.saveSecurity}
          />
        </TabsContent>

        <TabsContent value="browser" className="grid gap-6">
          <CapabilityCard
            title="Browser"
            capabilityTestId="node-capability-browser"
            description="Enable browser automation. This uses the existing Playwright-backed local browser provider."
            enabled={model.security.capabilities.playwright}
            onEnabledChange={(next) => model.setCapability("playwright", next)}
          />
          <AllowlistCard
            title="Browser domain allowlist"
            active={model.browserAllowlistActive}
            value={model.browserDomainsDraft}
            onChange={model.updateBrowserDomains}
            placeholder={"example.com\ndocs.example.com\n*"}
            notes={BROWSER_DOMAIN_NOTES}
            warningTitle="Browser allowlist is active and empty"
            warningDescription="Browser navigation is default deny until you add at least one domain (or `*`)."
            showWarning={
              model.browserAllowlistActive && model.security.web.allowedDomains.length === 0
            }
          />
          <Card>
            <CardContent className="grid gap-4 pt-6">
              <div className="flex items-center justify-between gap-4 border-b border-border py-2">
                <div>
                  <div className="text-sm font-semibold text-fg">Headless mode</div>
                  <div className="text-sm text-fg-muted">
                    Launch the local browser without opening a visible window.
                  </div>
                </div>
                <Switch
                  checked={model.security.web.headless}
                  onCheckedChange={model.setBrowserHeadless}
                />
              </div>
            </CardContent>
          </Card>
          <SaveActions
            buttonLabel="Save Node Settings"
            testId="node-configure-save-security"
            isLoading={model.securitySaving}
            saved={model.securitySaved}
            disabled={saveBusy || !model.securityDirty}
            errorMessage={model.securityError}
            onSave={model.saveSecurity}
          />
        </TabsContent>

        <TabsContent value="shell" className="grid gap-6">
          <CapabilityCard
            title="Shell"
            capabilityTestId="node-capability-shell"
            description="Enable local shell command execution through the desktop node runtime."
            enabled={model.security.capabilities.cli}
            onEnabledChange={(next) => model.setCapability("cli", next)}
          />
          <AllowlistCard
            title="Allowed commands"
            active={model.shellAllowlistActive}
            value={model.cliCommandsDraft}
            onChange={(value) => model.updateCliField("allowedCommands", value)}
            placeholder={"git status\nnode --version\n*"}
            notes={SHELL_COMMAND_NOTES}
            warningTitle="Shell allowlist is active and empty"
            warningDescription="Shell execution is default deny until you add at least one rule (or `*`)."
            showWarning={
              model.shellAllowlistActive && model.security.cli.allowedCommands.length === 0
            }
          />
          <AllowlistCard
            title="Allowed working directories"
            active={model.shellAllowlistActive}
            value={model.cliWorkingDirsDraft}
            onChange={(value) => model.updateCliField("allowedWorkingDirs", value)}
            placeholder={"/home/user/projects\n*"}
            notes={SHELL_DIRECTORY_NOTES}
          />
          <SaveActions
            buttonLabel="Save Node Settings"
            testId="node-configure-save-security"
            isLoading={model.securitySaving}
            saved={model.securitySaved}
            disabled={saveBusy || !model.securityDirty}
            errorMessage={model.securityError}
            onSave={model.saveSecurity}
          />
        </TabsContent>

        <TabsContent value="web" className="grid gap-6">
          <CapabilityCard
            title="Web"
            capabilityTestId="node-capability-web"
            description="Enable outbound HTTP access from the local node runtime."
            enabled={model.security.capabilities.http}
            onEnabledChange={(next) => model.setCapability("http", next)}
          />
          <Alert
            variant="info"
            title="No additional Web settings yet"
            description="This tab controls whether the local node advertises Web access. Domain and request policy settings are not part of this pass."
          />
          <SaveActions
            buttonLabel="Save Node Settings"
            testId="node-configure-save-security"
            isLoading={model.securitySaving}
            saved={model.securitySaved}
            disabled={saveBusy || !model.securityDirty}
            errorMessage={model.securityError}
            onSave={model.saveSecurity}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function SecurityProfileCard({
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

function NodeConnectionCard(props: {
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

function CapabilityCard(props: {
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

function AllowlistCard(props: {
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

function MacPermissionsCard(props: {
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

function SaveActions(props: {
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

function useDesktopNodeConfigureModel(api: DesktopApi, onReloadPage?: () => void) {
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [security, setSecurity] = useState<SecurityState>({
    profile: DEFAULT_PROFILE,
    overrides: {},
    capabilities: DEFAULT_CAPABILITIES,
    cli: DEFAULT_CLI_CONFIG,
    web: DEFAULT_WEB_CONFIG,
  });
  const [connection, setConnection] = useState<ConnectionState>({
    mode: "embedded",
    port: 8788,
    remoteUrl: "ws://127.0.0.1:8788/ws",
    remoteToken: "",
    remoteTlsCertFingerprint256: "",
    remoteTlsAllowSelfSigned: false,
    hasSavedRemoteToken: false,
  });
  const [backgroundState, setBackgroundState] = useState<DesktopBackgroundState | null>(null);
  const [backgroundBusy, setBackgroundBusy] = useState(false);
  const [backgroundError, setBackgroundError] = useState<string | null>(null);
  const [generalSaving, setGeneralSaving] = useState(false);
  const [generalSaved, setGeneralSaved] = useState(false);
  const [generalError, setGeneralError] = useState<string | null>(null);
  const [securitySaving, setSecuritySaving] = useState(false);
  const [securitySaved, setSecuritySaved] = useState(false);
  const [securityError, setSecurityError] = useState<string | null>(null);
  const [macPermissionSummary, setMacPermissionSummary] = useState<string | null>(null);
  const [macPermissionChecking, setMacPermissionChecking] = useState(false);
  const [requestingMacPermission, setRequestingMacPermission] = useState<
    "accessibility" | "screenRecording" | null
  >(null);
  const [macPermissionError, setMacPermissionError] = useState<string | null>(null);
  const [allowlistDrafts, setAllowlistDrafts] = useState<AllowlistDraftState>({
    browserDomains: "",
    cliCommands: "",
    cliWorkingDirs: "",
  });
  const saveResetTimers = useRef<SaveResetTimers>({
    general: null,
    security: null,
  });
  const initialSecurityRef = useRef<SecurityState | null>(null);
  const initialConnectionRef = useRef<ConnectionState | null>(null);
  const saveInFlightRef = useRef<"general" | "security" | null>(null);

  useEffect(() => {
    return () => {
      for (const key of ["general", "security"] as const) {
        if (saveResetTimers.current[key]) {
          clearTimeout(saveResetTimers.current[key]);
          saveResetTimers.current[key] = null;
        }
      }
    };
  }, []);

  useEffect(() => {
    let disposed = false;

    void api
      .getConfig()
      .then((config) => {
        if (disposed) return;
        const nextSecurity = readSecurityState(config);
        const nextConnection = readConnectionState(config);
        setSecurity(nextSecurity);
        setAllowlistDrafts(createAllowlistDraftState(nextSecurity));
        setConnection(nextConnection);
        initialSecurityRef.current = cloneSecurityState(nextSecurity);
        initialConnectionRef.current = cloneConnectionState(nextConnection);
        setLoadError(null);
      })
      .catch((error: unknown) => {
        if (disposed) return;
        setLoadError(formatErrorMessage(error));
      })
      .finally(() => {
        if (!disposed) {
          setLoading(false);
        }
      });

    if (api.background?.getState) {
      void api.background
        .getState()
        .then((state) => {
          if (disposed) return;
          setBackgroundState(state);
        })
        .catch(() => {
          // Background mode remains unavailable.
        });
    }

    return () => {
      disposed = true;
    };
  }, [api]);

  const displayProfile = useMemo<DisplayProfile>(
    () => (isSecurityPresetMatch(security.profile, security) ? security.profile : "custom"),
    [security],
  );
  const allowlistMode = useMemo(
    () => getAllowlistMode(security.profile, security.capabilities),
    [security.capabilities, security.profile],
  );
  const securityDirty =
    initialSecurityRef.current === null
      ? false
      : !areSecurityStatesEqual(initialSecurityRef.current, security);
  const generalDirty =
    initialConnectionRef.current === null
      ? false
      : hasConnectionSettingsChanged(initialConnectionRef.current, connection);

  const saveSucceeded = (
    channel: keyof SaveResetTimers,
    setSaved: (saved: boolean) => void,
    setError: (message: string | null) => void,
  ) => {
    setError(null);
    setSaved(true);
    if (saveResetTimers.current[channel]) {
      clearTimeout(saveResetTimers.current[channel]);
    }
    saveResetTimers.current[channel] = setTimeout(() => {
      setSaved(false);
      saveResetTimers.current[channel] = null;
    }, 2_000);
  };

  const persistSecurity = async (): Promise<void> => {
    await api.setConfig({
      permissions: {
        profile: security.profile,
        overrides: security.overrides,
      },
      capabilities: security.capabilities,
      cli: security.cli,
      web: security.web,
    });
    initialSecurityRef.current = cloneSecurityState(security);
  };

  const saveSecurity = () => {
    if (saveInFlightRef.current || securitySaving || !securityDirty) return;
    saveInFlightRef.current = "security";
    setSecuritySaving(true);
    setSecurityError(null);
    setSecuritySaved(false);
    void persistSecurity()
      .then(() => saveSucceeded("security", setSecuritySaved, setSecurityError))
      .catch((error: unknown) => setSecurityError(formatErrorMessage(error)))
      .finally(() => {
        saveInFlightRef.current = null;
        setSecuritySaving(false);
      });
  };

  const saveGeneral = () => {
    if (saveInFlightRef.current || generalSaving || (!generalDirty && !securityDirty)) return;

    const validationError = validateConnectionState(connection);
    if (validationError) {
      setGeneralError(validationError);
      setGeneralSaved(false);
      return;
    }

    saveInFlightRef.current = "general";
    setGeneralSaving(true);
    setGeneralError(null);
    setGeneralSaved(false);

    const previousConnection = initialConnectionRef.current
      ? cloneConnectionState(initialConnectionRef.current)
      : null;
    const partial = buildGeneralSavePartial(security, connection);
    const shouldReload = previousConnection
      ? hasConnectionSettingsChanged(previousConnection, connection)
      : true;
    const shouldStopEmbeddedGateway =
      previousConnection !== null &&
      shouldReload &&
      needsEmbeddedGatewayRestart(previousConnection, connection);

    void api
      .setConfig(partial)
      .then(async () => {
        initialSecurityRef.current = cloneSecurityState(security);
        initialConnectionRef.current = cloneConnectionState({
          ...connection,
          remoteToken: "",
          hasSavedRemoteToken:
            connection.mode === "remote"
              ? connection.hasSavedRemoteToken || connection.remoteToken.trim().length > 0
              : connection.hasSavedRemoteToken,
        });
        setConnection((current) => ({
          ...current,
          remoteToken: "",
          hasSavedRemoteToken:
            current.mode === "remote"
              ? current.hasSavedRemoteToken || current.remoteToken.trim().length > 0
              : current.hasSavedRemoteToken,
        }));

        if (shouldReload && onReloadPage) {
          await api.node.disconnect().catch(() => {
            // Retry bootstrap will recreate the node connection; disconnect is best-effort.
          });
          if (shouldStopEmbeddedGateway) {
            await api.gateway.stop().catch(() => {
              // Best-effort stop; retry bootstrap will surface any follow-up connection issue.
            });
          }
          onReloadPage();
          return;
        }

        saveSucceeded("general", setGeneralSaved, setGeneralError);
      })
      .catch((error: unknown) => setGeneralError(formatErrorMessage(error)))
      .finally(() => {
        saveInFlightRef.current = null;
        setGeneralSaving(false);
      });
  };

  const toggleBackgroundMode = (enabled: boolean) => {
    if (!api.background || backgroundBusy) return;
    setBackgroundBusy(true);
    setBackgroundError(null);
    void api.background
      .setEnabled(enabled)
      .then((state) => setBackgroundState(state))
      .catch((error: unknown) => setBackgroundError(formatErrorMessage(error)))
      .finally(() => setBackgroundBusy(false));
  };

  const checkMacPermissions = () => {
    if (!api.checkMacPermissions || macPermissionChecking) return;
    setMacPermissionChecking(true);
    setMacPermissionError(null);
    void api
      .checkMacPermissions()
      .then((snapshot) =>
        setMacPermissionSummary(
          describeMacPermissionSummary(snapshot as MacPermissionSnapshot | null),
        ),
      )
      .catch((error: unknown) => setMacPermissionError(formatErrorMessage(error)))
      .finally(() => setMacPermissionChecking(false));
  };

  const requestMacPermission = (permission: "accessibility" | "screenRecording") => {
    if (!api.requestMacPermission || requestingMacPermission !== null) return;
    setRequestingMacPermission(permission);
    setMacPermissionError(null);
    void api
      .requestMacPermission(permission)
      .then(() => {
        checkMacPermissions();
      })
      .catch((error: unknown) => setMacPermissionError(formatErrorMessage(error)))
      .finally(() => setRequestingMacPermission(null));
  };

  return {
    loading,
    loadError,
    security,
    connection,
    displayProfile,
    backgroundState,
    backgroundBusy,
    backgroundError,
    generalSaving,
    generalSaved,
    generalError,
    generalDirty,
    securitySaving,
    securitySaved,
    securityError,
    securityDirty,
    browserAllowlistActive: allowlistMode.web === "active",
    shellAllowlistActive: allowlistMode.cli === "active",
    browserDomainsDraft: allowlistDrafts.browserDomains,
    cliCommandsDraft: allowlistDrafts.cliCommands,
    cliWorkingDirsDraft: allowlistDrafts.cliWorkingDirs,
    macPermissionSummary,
    macPermissionChecking,
    requestingMacPermission,
    macPermissionError,
    applyProfile: (profile: DisplayProfile) => {
      if (profile === "custom") return;
      const nextSecurity = createProfilePreset(profile);
      setSecurity(nextSecurity);
      setAllowlistDrafts(createAllowlistDraftState(nextSecurity));
      setGeneralSaved(false);
      setSecuritySaved(false);
    },
    setCapability: (key: keyof CapFlags, nextEnabled: boolean) => {
      setSecurity((current) => ({
        ...current,
        capabilities: { ...current.capabilities, [key]: nextEnabled },
      }));
      setGeneralSaved(false);
      setSecuritySaved(false);
    },
    updateCliField: (field: keyof CliConfig, value: string) => {
      setSecurity((current) => ({
        ...current,
        cli: { ...current.cli, [field]: splitAllowlistLines(value) },
      }));
      setAllowlistDrafts((current) => ({
        ...current,
        [field === "allowedCommands" ? "cliCommands" : "cliWorkingDirs"]: value,
      }));
      setGeneralSaved(false);
      setSecuritySaved(false);
    },
    updateBrowserDomains: (value: string) => {
      setSecurity((current) => ({
        ...current,
        web: { ...current.web, allowedDomains: splitAllowlistLines(value) },
      }));
      setAllowlistDrafts((current) => ({ ...current, browserDomains: value }));
      setGeneralSaved(false);
      setSecuritySaved(false);
    },
    setBrowserHeadless: (headless: boolean) => {
      setSecurity((current) => ({
        ...current,
        web: { ...current.web, headless },
      }));
      setGeneralSaved(false);
      setSecuritySaved(false);
    },
    setMode: (mode: ConnectionState["mode"]) => {
      setConnection((current) => ({ ...current, mode }));
      setGeneralSaved(false);
    },
    setPort: (port: number) => {
      setConnection((current) => ({ ...current, port }));
      setGeneralSaved(false);
    },
    setRemoteUrl: (remoteUrl: string) => {
      setConnection((current) => ({ ...current, remoteUrl }));
      setGeneralSaved(false);
    },
    setRemoteToken: (remoteToken: string) => {
      setConnection((current) => ({ ...current, remoteToken }));
      setGeneralSaved(false);
    },
    setRemoteTlsCertFingerprint256: (remoteTlsCertFingerprint256: string) => {
      setConnection((current) => ({ ...current, remoteTlsCertFingerprint256 }));
      setGeneralSaved(false);
    },
    setRemoteTlsAllowSelfSigned: (remoteTlsAllowSelfSigned: boolean) => {
      setConnection((current) => ({ ...current, remoteTlsAllowSelfSigned }));
      setGeneralSaved(false);
    },
    saveSecurity,
    saveGeneral,
    toggleBackgroundMode,
    checkMacPermissions,
    requestMacPermission,
  };
}

function createProfilePreset(profile: Profile): SecurityState {
  return {
    profile,
    overrides: {},
    capabilities: capabilitiesForProfile(profile),
    cli: cloneCliConfig(DEFAULT_CLI_CONFIG),
    web: cloneWebConfig(DEFAULT_WEB_CONFIG),
  };
}

function readSecurityState(config: unknown): SecurityState {
  const parsed = config as Record<string, unknown>;
  const permissions = parsed["permissions"] as Record<string, unknown> | undefined;
  const rawProfile = permissions?.["profile"];
  const profile: Profile =
    rawProfile === "safe" || rawProfile === "balanced" || rawProfile === "poweruser"
      ? rawProfile
      : DEFAULT_PROFILE;

  const overrides =
    permissions?.["overrides"] && typeof permissions["overrides"] === "object"
      ? Object.fromEntries(
          Object.entries(permissions["overrides"] as Record<string, unknown>).flatMap(
            ([key, value]) => (typeof value === "boolean" ? [[key, value]] : []),
          ),
        )
      : {};
  const capabilities = parsed["capabilities"] as CapFlags | undefined;
  const cli = parsed["cli"] as CliConfig | undefined;
  const web = parsed["web"] as WebConfig | undefined;

  return {
    profile,
    overrides,
    capabilities: capabilities ?? DEFAULT_CAPABILITIES,
    cli: cli ? cloneCliConfig(cli) : cloneCliConfig(DEFAULT_CLI_CONFIG),
    web: web ? cloneWebConfig(web) : cloneWebConfig(DEFAULT_WEB_CONFIG),
  };
}

function readConnectionState(config: unknown): ConnectionState {
  const parsed = config as Record<string, unknown>;
  const mode = parsed["mode"] === "remote" ? "remote" : "embedded";
  const embedded = parsed["embedded"] as Record<string, unknown> | undefined;
  const remote = parsed["remote"] as Record<string, unknown> | undefined;
  const tokenRef = typeof remote?.["tokenRef"] === "string" ? remote["tokenRef"] : "";

  return {
    mode,
    port: typeof embedded?.["port"] === "number" ? embedded["port"] : 8788,
    remoteUrl: typeof remote?.["wsUrl"] === "string" ? remote["wsUrl"] : "ws://127.0.0.1:8788/ws",
    remoteToken: "",
    remoteTlsCertFingerprint256:
      typeof remote?.["tlsCertFingerprint256"] === "string" ? remote["tlsCertFingerprint256"] : "",
    remoteTlsAllowSelfSigned: remote?.["tlsAllowSelfSigned"] === true,
    hasSavedRemoteToken: tokenRef.trim().length > 0,
  };
}

function isSecurityPresetMatch(profile: Profile, security: SecurityState): boolean {
  if (Object.keys(security.overrides).length > 0) return false;
  return (
    shallowEqualCapFlags(security.capabilities, capabilitiesForProfile(profile)) &&
    areCliConfigsEqual(security.cli, DEFAULT_CLI_CONFIG) &&
    areWebConfigsEqual(security.web, DEFAULT_WEB_CONFIG)
  );
}

function hasConnectionSettingsChanged(
  initialState: ConnectionState,
  currentState: ConnectionState,
): boolean {
  if (initialState.mode !== currentState.mode) return true;
  if (currentState.mode === "embedded") {
    return initialState.port !== currentState.port;
  }

  return (
    normalizeRemoteUrl(initialState.remoteUrl) !== normalizeRemoteUrl(currentState.remoteUrl) ||
    initialState.remoteTlsAllowSelfSigned !== currentState.remoteTlsAllowSelfSigned ||
    normalizeTlsFingerprint(initialState.remoteTlsCertFingerprint256) !==
      normalizeTlsFingerprint(currentState.remoteTlsCertFingerprint256) ||
    currentState.remoteToken.trim().length > 0
  );
}

function needsEmbeddedGatewayRestart(
  initialState: ConnectionState,
  currentState: ConnectionState,
): boolean {
  return initialState.mode === "embedded" || currentState.mode === "embedded";
}

function validateConnectionState(state: ConnectionState): string | null {
  if (state.mode === "embedded") {
    if (!Number.isInteger(state.port) || state.port < 1024 || state.port > 65535) {
      return "Embedded gateway port must be an integer between 1024 and 65535.";
    }
    return null;
  }

  const wsUrl = normalizeRemoteUrl(state.remoteUrl);
  if (!wsUrl) {
    return "Remote WebSocket URL is required.";
  }
  try {
    const parsed = new URL(wsUrl);
    if (parsed.protocol !== "ws:" && parsed.protocol !== "wss:") {
      throw new Error("invalid protocol");
    }
  } catch {
    return "Remote WebSocket URL must be a valid ws:// or wss:// URL.";
  }

  if (!state.hasSavedRemoteToken && state.remoteToken.trim().length === 0) {
    return "A gateway token is required for remote mode.";
  }

  if (
    state.remoteTlsAllowSelfSigned &&
    normalizeTlsFingerprint(state.remoteTlsCertFingerprint256) === ""
  ) {
    return "Allow self-signed TLS requires a certificate fingerprint.";
  }

  return null;
}

function buildGeneralSavePartial(security: SecurityState, connection: ConnectionState) {
  const partial: Record<string, unknown> = {
    permissions: {
      profile: security.profile,
      overrides: security.overrides,
    },
    capabilities: security.capabilities,
    cli: security.cli,
    web: security.web,
    mode: connection.mode,
  };

  if (connection.mode === "embedded") {
    partial["embedded"] = { port: connection.port };
    return partial;
  }

  const remoteConfig: Record<string, unknown> = {
    wsUrl: normalizeRemoteUrl(connection.remoteUrl),
    tlsCertFingerprint256: normalizeTlsFingerprint(connection.remoteTlsCertFingerprint256),
    tlsAllowSelfSigned: connection.remoteTlsAllowSelfSigned,
  };
  const trimmedToken = connection.remoteToken.trim();
  if (trimmedToken.length > 0) {
    remoteConfig["tokenRef"] = trimmedToken;
  }
  partial["remote"] = remoteConfig;
  return partial;
}

function cloneSecurityState(state: SecurityState): SecurityState {
  return {
    profile: state.profile,
    overrides: { ...state.overrides },
    capabilities: { ...state.capabilities },
    cli: cloneCliConfig(state.cli),
    web: cloneWebConfig(state.web),
  };
}

function cloneConnectionState(state: ConnectionState): ConnectionState {
  return { ...state };
}

function cloneCliConfig(config: CliConfig): CliConfig {
  return {
    allowedCommands: [...config.allowedCommands],
    allowedWorkingDirs: [...config.allowedWorkingDirs],
  };
}

function cloneWebConfig(config: WebConfig): WebConfig {
  return {
    allowedDomains: [...config.allowedDomains],
    headless: config.headless,
  };
}

function createAllowlistDraftState(security: SecurityState): AllowlistDraftState {
  return {
    browserDomains: joinAllowlistLines(security.web.allowedDomains),
    cliCommands: joinAllowlistLines(security.cli.allowedCommands),
    cliWorkingDirs: joinAllowlistLines(security.cli.allowedWorkingDirs),
  };
}

function areSecurityStatesEqual(left: SecurityState, right: SecurityState): boolean {
  return (
    left.profile === right.profile &&
    shallowEqualBooleanRecord(left.overrides, right.overrides) &&
    shallowEqualCapFlags(left.capabilities, right.capabilities) &&
    areCliConfigsEqual(left.cli, right.cli) &&
    areWebConfigsEqual(left.web, right.web)
  );
}

function shallowEqualBooleanRecord(
  left: Record<string, boolean>,
  right: Record<string, boolean>,
): boolean {
  const leftKeys = Object.keys(left);
  const rightKeys = Object.keys(right);
  if (leftKeys.length !== rightKeys.length) return false;
  return leftKeys.every((key) => left[key] === right[key]);
}

function shallowEqualCapFlags(left: CapFlags, right: CapFlags): boolean {
  return (
    left.desktop === right.desktop &&
    left.playwright === right.playwright &&
    left.cli === right.cli &&
    left.http === right.http
  );
}

function areCliConfigsEqual(left: CliConfig, right: CliConfig): boolean {
  return (
    areStringArraysEqual(left.allowedCommands, right.allowedCommands) &&
    areStringArraysEqual(left.allowedWorkingDirs, right.allowedWorkingDirs)
  );
}

function areWebConfigsEqual(left: WebConfig, right: WebConfig): boolean {
  return (
    left.headless === right.headless &&
    areStringArraysEqual(left.allowedDomains, right.allowedDomains)
  );
}

function areStringArraysEqual(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function describeMacPermissionSummary(snapshot: MacPermissionSnapshot | null): string {
  if (!snapshot) {
    return "Not macOS (skipped).";
  }

  const missing = [
    snapshot.accessibility === true ? null : "Accessibility",
    snapshot.screenRecording === true ? null : "Screen Recording",
  ].filter((value): value is string => value !== null);
  if (missing.length === 0) {
    return "All macOS permissions granted.";
  }

  const instructions =
    typeof snapshot.instructions === "string" && snapshot.instructions.trim().length > 0
      ? ` ${snapshot.instructions.trim()}`
      : "";
  return `Missing: ${missing.join(", ")}.${instructions}`;
}

function normalizeRemoteUrl(value: string): string {
  return value.trim();
}

function normalizeTlsFingerprint(value: string): string {
  return value.trim();
}

function joinAllowlistLines(lines: string[]): string {
  return lines.join("\n");
}

function splitAllowlistLines(value: string): string[] {
  return value
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}
