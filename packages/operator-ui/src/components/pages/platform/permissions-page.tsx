import { useEffect, useMemo, useState } from "react";
import type { DesktopApi } from "../../../desktop-api.js";
import { useHostApi } from "../../../host/host-api.js";
import { formatErrorMessage } from "../../../utils/format-error-message.js";
import {
  capabilitiesForProfile,
  getAllowlistMode,
  type CapFlags,
  type Profile,
} from "../../../utils/permission-profile.js";
import { Alert } from "../../ui/alert.js";
import { Badge } from "../../ui/badge.js";
import { Button } from "../../ui/button.js";
import { Card, CardContent } from "../../ui/card.js";
import { Label } from "../../ui/label.js";
import { RadioGroup, RadioGroupItem } from "../../ui/radio-group.js";
import { Switch } from "../../ui/switch.js";
import { Textarea } from "../../ui/textarea.js";

const PROFILES: { id: Profile; label: string; description: string }[] = [
  {
    id: "safe",
    label: "Safe",
    description:
      "Screenshot only. No input control, CLI, or web automation. All actions require human confirmation.",
  },
  {
    id: "balanced",
    label: "Balanced",
    description:
      "Screenshot + input with confirmation. CLI and web limited to allowlists. Recommended for most users.",
  },
  {
    id: "poweruser",
    label: "Power User",
    description:
      "Full access to desktop, CLI, and web automation. No confirmation prompts. Use with caution.",
  },
];

interface CliConfig {
  allowedCommands: string[];
  allowedWorkingDirs: string[];
}

interface WebConfig {
  allowedDomains: string[];
  headless: boolean;
}

const DEFAULT_PROFILE: Profile = "balanced";
// Preserve the historical restrictive fallback until the stored config provides capabilities.
const DEFAULT_CAPABILITIES = capabilitiesForProfile("safe");
const DEFAULT_CLI_CONFIG: CliConfig = { allowedCommands: [], allowedWorkingDirs: [] };
const DEFAULT_WEB_CONFIG: WebConfig = { allowedDomains: [], headless: true };
const CAPABILITY_OPTIONS = [
  ["desktop", "Desktop (screenshot & input)"],
  ["playwright", "Playwright (web automation)"],
  ["cli", "CLI (command execution)"],
  ["http", "HTTP (network requests)"],
] as const satisfies ReadonlyArray<readonly [keyof CapFlags, string]>;
const CLI_COMMAND_NOTES = [
  "- Use one rule per line.",
  "- `*` allows all commands.",
  "- Subcommand rules are prefix matches. `git status` allows `git status -sb`, but does not allow `git push`.",
  "- A bare command (for example `git`) allows all its subcommands.",
];
const CLI_DIRECTORY_NOTES = [
  "- `*` allows any working directory when CLI allowlist enforcement is active.",
];
const WEB_DOMAIN_NOTES = [
  "- Use one domain per line.",
  "- Subdomains are allowed automatically.",
  "- `*` allows all domains.",
];

export function PlatformPermissionsPage() {
  const host = useHostApi();
  if (host.kind !== "desktop") {
    return (
      <div className="grid gap-6">
        <h1 className="text-2xl font-semibold tracking-tight text-fg">Permissions</h1>
        <Alert
          variant="warning"
          title="Not available"
          description="Platform permission controls are only available in the desktop app."
        />
      </div>
    );
  }

  const api = host.api;
  if (!api) {
    return (
      <div className="grid gap-6">
        <h1 className="text-2xl font-semibold tracking-tight text-fg">Permissions</h1>
        <Alert variant="error" title="Desktop API not available." />
      </div>
    );
  }

  return <DesktopPermissionsPage api={api} />;
}

function DesktopPermissionsPage({ api }: { api: DesktopApi }) {
  const model = useDesktopPermissionsModel(api);

  return (
    <div className="grid gap-6">
      <h1 className="text-2xl font-semibold tracking-tight text-fg">Permissions</h1>
      <SecurityProfileCard profile={model.profile} onProfileChange={model.applyProfile} />
      <CapabilitiesCard
        capabilities={model.capabilities}
        onCapabilityChange={model.setCapability}
      />
      <CliAllowlistCard
        cli={model.cli}
        cliAllowlistActive={model.cliAllowlistActive}
        onCommandsChange={(value) => model.updateCliField("allowedCommands", value)}
        onWorkingDirsChange={(value) => model.updateCliField("allowedWorkingDirs", value)}
      />
      <WebAllowlistCard
        web={model.web}
        webAllowlistActive={model.webAllowlistActive}
        onDomainsChange={model.updateWebDomains}
        onHeadlessChange={model.setHeadless}
      />
      <SavePermissionsActions saved={model.saved} saveError={model.saveError} onSave={model.save} />
    </div>
  );
}

function SecurityProfileCard(props: {
  profile: Profile;
  onProfileChange: (profile: Profile) => void;
}) {
  return (
    <Card>
      <CardContent className="grid gap-4 pt-6">
        <div className="text-sm font-semibold text-fg">Security Profile</div>
        <RadioGroup
          value={props.profile}
          onValueChange={(value) => props.onProfileChange(value as Profile)}
        >
          {PROFILES.map((profile) => (
            <SecurityProfileOption
              key={profile.id}
              profile={profile}
              active={props.profile === profile.id}
            />
          ))}
        </RadioGroup>
      </CardContent>
    </Card>
  );
}

function SecurityProfileOption(props: {
  profile: { id: Profile; label: string; description: string };
  active: boolean;
}) {
  const radioId = `permission-profile-${props.profile.id}`;
  return (
    <div
      className={[
        "flex items-start gap-3 rounded-md border p-3",
        props.active ? "border-primary bg-primary-dim" : "border-border bg-bg-card",
      ].join(" ")}
    >
      <RadioGroupItem id={radioId} value={props.profile.id} />
      <div className="grid gap-1">
        <Label htmlFor={radioId} className="text-sm font-medium text-fg">
          {props.profile.label}
        </Label>
        <div className="text-sm text-fg-muted">{props.profile.description}</div>
      </div>
    </div>
  );
}

function CapabilitiesCard(props: {
  capabilities: CapFlags;
  onCapabilityChange: (key: keyof CapFlags, nextEnabled: boolean) => void;
}) {
  return (
    <Card>
      <CardContent className="grid gap-4 pt-6">
        <div className="text-sm font-semibold text-fg">Capabilities</div>
        <div className="text-sm text-fg-muted">
          Switching profile applies recommended capability defaults for that profile. You can still
          adjust these before saving.
        </div>
        <div className="grid gap-3">
          {CAPABILITY_OPTIONS.map(([key, label]) => (
            <div
              key={key}
              className="flex items-center justify-between gap-4 border-b border-border py-2 last:border-b-0"
            >
              <div className="text-sm text-fg">{label}</div>
              <Switch
                checked={props.capabilities[key]}
                onCheckedChange={(checked) => props.onCapabilityChange(key, checked)}
              />
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

function CliAllowlistCard(props: {
  cli: CliConfig;
  cliAllowlistActive: boolean;
  onCommandsChange: (value: string) => void;
  onWorkingDirsChange: (value: string) => void;
}) {
  return (
    <Card>
      <CardContent className="grid gap-4 pt-6">
        <AllowlistHeader title="CLI Allowlist" active={props.cliAllowlistActive} />
        <Textarea
          label="Allowed Commands (one per line)"
          value={joinAllowlistLines(props.cli.allowedCommands)}
          disabled={!props.cliAllowlistActive}
          onChange={(event) => props.onCommandsChange(event.target.value)}
          placeholder={"git status\nnode --version\n*"}
        />
        <FieldNotes notes={CLI_COMMAND_NOTES} />
        {props.cliAllowlistActive && props.cli.allowedCommands.length === 0 ? (
          <Alert
            variant="warning"
            title="CLI allowlist is active and empty"
            description="Command execution is default deny until you add at least one rule (or '*')."
          />
        ) : null}
        <Textarea
          label="Allowed Working Directories (one per line)"
          value={joinAllowlistLines(props.cli.allowedWorkingDirs)}
          disabled={!props.cliAllowlistActive}
          onChange={(event) => props.onWorkingDirsChange(event.target.value)}
          placeholder={"/home/user/projects\n*"}
        />
        <FieldNotes notes={CLI_DIRECTORY_NOTES} />
      </CardContent>
    </Card>
  );
}

function WebAllowlistCard(props: {
  web: WebConfig;
  webAllowlistActive: boolean;
  onDomainsChange: (value: string) => void;
  onHeadlessChange: (headless: boolean) => void;
}) {
  return (
    <Card>
      <CardContent className="grid gap-4 pt-6">
        <AllowlistHeader title="Web / Playwright" active={props.webAllowlistActive} />
        <Textarea
          label="Allowed Domains (one per line)"
          value={joinAllowlistLines(props.web.allowedDomains)}
          disabled={!props.webAllowlistActive}
          onChange={(event) => props.onDomainsChange(event.target.value)}
          placeholder={"example.com\ndocs.example.com\n*"}
        />
        <FieldNotes notes={WEB_DOMAIN_NOTES} />
        {props.webAllowlistActive && props.web.allowedDomains.length === 0 ? (
          <Alert
            variant="warning"
            title="Domain allowlist is active and empty"
            description="Web navigation is default deny until you add at least one domain (or '*')."
          />
        ) : null}
        <div className="flex items-center justify-between gap-4 border-b border-border py-2">
          <div className="text-sm text-fg">Headless mode</div>
          <Switch checked={props.web.headless} onCheckedChange={props.onHeadlessChange} />
        </div>
      </CardContent>
    </Card>
  );
}

function SavePermissionsActions(props: {
  saved: boolean;
  saveError: string | null;
  onSave: () => void;
}) {
  return (
    <div className="grid gap-3">
      <Button onClick={props.onSave}>{props.saved ? "Saved!" : "Save Permissions"}</Button>
      {props.saveError ? (
        <Alert variant="error" title="Save failed" description={props.saveError} />
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

function useDesktopPermissionsModel(api: DesktopApi) {
  const [profile, setProfile] = useState<Profile>(DEFAULT_PROFILE);
  const [capabilities, setCapabilities] = useState<CapFlags>(DEFAULT_CAPABILITIES);
  const [cli, setCli] = useState<CliConfig>(DEFAULT_CLI_CONFIG);
  const [web, setWeb] = useState<WebConfig>(DEFAULT_WEB_CONFIG);
  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const allowlistMode = useMemo(
    () => getAllowlistMode(profile, capabilities),
    [profile, capabilities],
  );

  useEffect(() => {
    let disposed = false;
    void api.getConfig().then((config) => {
      if (disposed) {
        return;
      }
      const loaded = readPermissionConfig(config);
      if (loaded.profile) {
        setProfile(loaded.profile);
      }
      if (loaded.capabilities) {
        setCapabilities(loaded.capabilities);
      }
      if (loaded.cli) {
        setCli(loaded.cli);
      }
      if (loaded.web) {
        setWeb(loaded.web);
      }
    });
    return () => {
      disposed = true;
    };
  }, [api]);

  const save = () => {
    setSaveError(null);
    void api
      .setConfig({
        permissions: { profile },
        capabilities,
        cli,
        web,
      })
      .then(() => {
        setSaved(true);
        setTimeout(() => setSaved(false), 2000);
      })
      .catch((error: unknown) => setSaveError(formatErrorMessage(error)));
  };

  return {
    profile,
    capabilities,
    cli,
    web,
    saved,
    saveError,
    cliAllowlistActive: allowlistMode.cli === "active",
    webAllowlistActive: allowlistMode.web === "active",
    applyProfile: (nextProfile: Profile) => {
      setProfile(nextProfile);
      setCapabilities(capabilitiesForProfile(nextProfile));
    },
    setCapability: (key: keyof CapFlags, nextEnabled: boolean) => {
      setCapabilities((current) => ({ ...current, [key]: nextEnabled }));
    },
    updateCliField: (field: keyof CliConfig, value: string) => {
      setCli((current) => ({ ...current, [field]: splitAllowlistLines(value) }));
    },
    updateWebDomains: (value: string) => {
      setWeb((current) => ({ ...current, allowedDomains: splitAllowlistLines(value) }));
    },
    setHeadless: (headless: boolean) => {
      setWeb((current) => ({ ...current, headless }));
    },
    save,
  };
}

function readPermissionConfig(config: unknown): {
  profile?: Profile;
  capabilities?: CapFlags;
  cli?: CliConfig;
  web?: WebConfig;
} {
  const parsed = config as Record<string, unknown>;
  const permissions = parsed?.["permissions"] as Record<string, unknown> | undefined;
  const profile =
    typeof permissions?.["profile"] === "string" ? (permissions["profile"] as Profile) : undefined;
  const capabilities = parsed?.["capabilities"] as CapFlags | undefined;
  const cli = parsed?.["cli"] as CliConfig | undefined;
  const web = parsed?.["web"] as WebConfig | undefined;
  return { profile, capabilities, cli, web };
}

function joinAllowlistLines(lines: string[]): string {
  return lines.join("\n");
}

function splitAllowlistLines(value: string): string[] {
  return value.split("\n").filter(Boolean);
}
