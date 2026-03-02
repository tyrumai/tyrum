import { useEffect, useMemo, useState } from "react";
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

  const [profile, setProfile] = useState<Profile>("balanced");
  const [capabilities, setCapabilities] = useState<CapFlags>({
    desktop: true,
    playwright: false,
    cli: false,
    http: false,
  });
  const [cli, setCli] = useState<CliConfig>({
    allowedCommands: [],
    allowedWorkingDirs: [],
  });
  const [web, setWeb] = useState<WebConfig>({
    allowedDomains: [],
    headless: true,
  });
  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const allowlistMode = useMemo(
    () => getAllowlistMode(profile, capabilities),
    [profile, capabilities],
  );
  const cliAllowlistActive = allowlistMode.cli === "active";
  const webAllowlistActive = allowlistMode.web === "active";

  useEffect(() => {
    let disposed = false;
    void api.getConfig().then((cfg) => {
      if (disposed) return;
      const c = cfg as Record<string, unknown>;
      const perms = c?.["permissions"] as Record<string, unknown> | undefined;
      if (typeof perms?.["profile"] === "string") setProfile(perms["profile"] as Profile);

      const caps = c?.["capabilities"] as CapFlags | undefined;
      if (caps) setCapabilities(caps);

      const cliCfg = c?.["cli"] as CliConfig | undefined;
      if (cliCfg) setCli(cliCfg);

      const webCfg = c?.["web"] as WebConfig | undefined;
      if (webCfg) setWeb(webCfg);
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
      .catch((error: unknown) => {
        setSaveError(formatErrorMessage(error));
      });
  };

  const applyProfile = (nextProfile: Profile) => {
    setProfile(nextProfile);
    setCapabilities(capabilitiesForProfile(nextProfile));
  };

  const setCapability = (key: keyof CapFlags, nextEnabled: boolean) => {
    setCapabilities((prev) => ({ ...prev, [key]: nextEnabled }));
  };

  return (
    <div className="grid gap-6">
      <h1 className="text-2xl font-semibold tracking-tight text-fg">Permissions</h1>

      <Card>
        <CardContent className="grid gap-4 pt-6">
          <div className="text-sm font-semibold text-fg">Security Profile</div>
          <RadioGroup value={profile} onValueChange={(value) => applyProfile(value as Profile)}>
            {PROFILES.map((p) => {
              const radioId = `permission-profile-${p.id}`;
              const active = profile === p.id;
              return (
                <div
                  key={p.id}
                  className={[
                    "flex items-start gap-3 rounded-md border p-3",
                    active ? "border-primary bg-primary-dim" : "border-border bg-bg-card",
                  ].join(" ")}
                >
                  <RadioGroupItem id={radioId} value={p.id} />
                  <div className="grid gap-1">
                    <Label htmlFor={radioId} className="text-sm font-medium text-fg">
                      {p.label}
                    </Label>
                    <div className="text-sm text-fg-muted">{p.description}</div>
                  </div>
                </div>
              );
            })}
          </RadioGroup>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="grid gap-4 pt-6">
          <div className="text-sm font-semibold text-fg">Capabilities</div>
          <div className="text-sm text-fg-muted">
            Switching profile applies recommended capability defaults for that profile. You can
            still adjust these before saving.
          </div>
          <div className="grid gap-3">
            {(
              [
                ["desktop", "Desktop (screenshot & input)"],
                ["playwright", "Playwright (web automation)"],
                ["cli", "CLI (command execution)"],
                ["http", "HTTP (network requests)"],
              ] as const
            ).map(([key, label]) => (
              <div
                key={key}
                className="flex items-center justify-between gap-4 border-b border-border py-2 last:border-b-0"
              >
                <div className="text-sm text-fg">{label}</div>
                <Switch
                  checked={capabilities[key]}
                  onCheckedChange={(checked) => setCapability(key, checked)}
                />
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="grid gap-4 pt-6">
          <div className="flex items-center justify-between gap-3">
            <div className="text-sm font-semibold text-fg">CLI Allowlist</div>
            <Badge variant={cliAllowlistActive ? "danger" : "success"}>
              {cliAllowlistActive ? "active (default deny)" : "inactive (default allow)"}
            </Badge>
          </div>

          <Textarea
            label="Allowed Commands (one per line)"
            value={cli.allowedCommands.join("\n")}
            disabled={!cliAllowlistActive}
            onChange={(e) =>
              setCli((prev) => ({
                ...prev,
                allowedCommands: e.target.value.split("\n").filter(Boolean),
              }))
            }
            placeholder={"git status\nnode --version\n*"}
          />

          <div className="grid gap-1 text-sm text-fg-muted">
            <div>- Use one rule per line.</div>
            <div>- `*` allows all commands.</div>
            <div>
              - Subcommand rules are prefix matches. `git status` allows `git status -sb`, but does
              not allow `git push`.
            </div>
            <div>- A bare command (for example `git`) allows all its subcommands.</div>
          </div>

          {cliAllowlistActive && cli.allowedCommands.length === 0 ? (
            <Alert
              variant="warning"
              title="CLI allowlist is active and empty"
              description="Command execution is default deny until you add at least one rule (or '*')."
            />
          ) : null}

          <Textarea
            label="Allowed Working Directories (one per line)"
            value={cli.allowedWorkingDirs.join("\n")}
            disabled={!cliAllowlistActive}
            onChange={(e) =>
              setCli((prev) => ({
                ...prev,
                allowedWorkingDirs: e.target.value.split("\n").filter(Boolean),
              }))
            }
            placeholder={"/home/user/projects\n*"}
          />

          <div className="grid gap-1 text-sm text-fg-muted">
            <div>- `*` allows any working directory when CLI allowlist enforcement is active.</div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="grid gap-4 pt-6">
          <div className="flex items-center justify-between gap-3">
            <div className="text-sm font-semibold text-fg">Web / Playwright</div>
            <Badge variant={webAllowlistActive ? "danger" : "success"}>
              {webAllowlistActive ? "active (default deny)" : "inactive (default allow)"}
            </Badge>
          </div>

          <Textarea
            label="Allowed Domains (one per line)"
            value={web.allowedDomains.join("\n")}
            disabled={!webAllowlistActive}
            onChange={(e) =>
              setWeb((prev) => ({
                ...prev,
                allowedDomains: e.target.value.split("\n").filter(Boolean),
              }))
            }
            placeholder={"example.com\ndocs.example.com\n*"}
          />

          <div className="grid gap-1 text-sm text-fg-muted">
            <div>- Use one domain per line.</div>
            <div>- Subdomains are allowed automatically.</div>
            <div>- `*` allows all domains.</div>
          </div>

          {webAllowlistActive && web.allowedDomains.length === 0 ? (
            <Alert
              variant="warning"
              title="Domain allowlist is active and empty"
              description="Web navigation is default deny until you add at least one domain (or '*')."
            />
          ) : null}

          <div className="flex items-center justify-between gap-4 border-b border-border py-2">
            <div className="text-sm text-fg">Headless mode</div>
            <Switch
              checked={web.headless}
              onCheckedChange={(checked) => {
                setWeb((prev) => ({ ...prev, headless: checked }));
              }}
            />
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-3">
        <Button onClick={save}>{saved ? "Saved!" : "Save Permissions"}</Button>
        {saveError ? <Alert variant="error" title="Save failed" description={saveError} /> : null}
      </div>
    </div>
  );
}
