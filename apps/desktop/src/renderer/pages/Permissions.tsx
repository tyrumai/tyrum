import { useEffect, useMemo, useState } from "react";
import { toErrorMessage } from "../lib/errors.js";
import {
  capabilitiesForProfile,
  getAllowlistMode,
  type CapFlags,
  type Profile,
} from "../lib/permission-profile.js";
import { colors, heading, card, sectionTitle, btn as btnFn, help, warn, toggleRow, toggleLabel, textarea, statusBadge, label as themeLabel } from "../theme.js";

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

function radioLabelActiveStyle(active: boolean): React.CSSProperties {
  return {
    display: "flex",
    alignItems: "flex-start",
    gap: 10,
    padding: "10px 12px",
    borderRadius: 6,
    cursor: "pointer",
    marginBottom: 4,
    background: active ? colors.primaryDim : "transparent",
    border: active ? `1px solid ${colors.primary}` : "1px solid transparent",
  };
}

interface CliConfig {
  allowedCommands: string[];
  allowedWorkingDirs: string[];
}

interface WebConfig {
  allowedDomains: string[];
  headless: boolean;
}

export function Permissions() {
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
    const api = window.tyrumDesktop;
    if (!api) return;

    void api.getConfig().then((cfg) => {
      const c = cfg as Record<string, unknown>;
      const perms = c?.["permissions"] as Record<string, unknown> | undefined;
      if (perms?.["profile"]) setProfile(perms["profile"] as Profile);

      const caps = c?.["capabilities"] as CapFlags | undefined;
      if (caps) setCapabilities(caps);

      const cliCfg = c?.["cli"] as CliConfig | undefined;
      if (cliCfg) setCli(cliCfg);

      const webCfg = c?.["web"] as WebConfig | undefined;
      if (webCfg) setWeb(webCfg);
    });
  }, []);

  const save = () => {
    const api = window.tyrumDesktop;
    if (!api) return;

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
        setSaveError(toErrorMessage(error));
      });
  };

  const applyProfile = (nextProfile: Profile) => {
    setProfile(nextProfile);
    setCapabilities(capabilitiesForProfile(nextProfile));
  };

  const toggleCap = (key: keyof CapFlags) => {
    setCapabilities((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  return (
    <div>
      <h1 style={heading}>Permissions</h1>

      <div style={card}>
        <div style={sectionTitle}>Security Profile</div>
        {PROFILES.map((p) => (
          <label key={p.id} style={radioLabelActiveStyle(profile === p.id)}>
            <input
              type="radio"
              name="profile"
              value={p.id}
              checked={profile === p.id}
              onChange={() => applyProfile(p.id)}
              style={{ marginTop: 3 }}
            />
            <div>
              <div style={{ fontWeight: 600, fontSize: 14 }}>{p.label}</div>
              <div style={{ fontSize: 12, color: colors.fgMuted, lineHeight: 1.4, marginTop: 2 }}>{p.description}</div>
            </div>
          </label>
        ))}
      </div>

      <div style={card}>
        <div style={sectionTitle}>Capabilities</div>
        <div style={help}>
          Switching profile applies recommended capability defaults for that
          profile. You can still adjust these before saving.
        </div>
        {(
          [
            ["desktop", "Desktop (screenshot & input)"],
            ["playwright", "Playwright (web automation)"],
            ["cli", "CLI (command execution)"],
            ["http", "HTTP (network requests)"],
          ] as const
        ).map(([key, label]) => (
          <div key={key} style={toggleRow}>
            <span style={toggleLabel}>{label}</span>
            <input
              type="checkbox"
              checked={capabilities[key]}
              onChange={() => toggleCap(key)}
            />
          </div>
        ))}
      </div>

      <div style={card}>
        <div style={sectionTitle}>CLI Allowlist</div>
        <div style={help}>
          Enforcement:
          <span
            style={{
              ...statusBadge,
              background: cliAllowlistActive ? "rgba(239,68,68,0.15)" : "rgba(34,197,94,0.15)",
              color: cliAllowlistActive ? colors.error : colors.success,
            }}
          >
            {cliAllowlistActive ? "active (default deny)" : "inactive (default allow)"}
          </span>
        </div>
        <div style={{ ...themeLabel, marginBottom: 4, marginTop: 12 }}>Allowed Commands (one per line)</div>
        <textarea
          style={textarea}
          value={cli.allowedCommands.join("\n")}
          disabled={!cliAllowlistActive}
          onChange={(e) =>
            setCli((prev) => ({
              ...prev,
              allowedCommands: e.target.value.split("\n").filter(Boolean),
            }))
          }
          placeholder="git status&#10;node --version&#10;*"
        />
        <div style={help}>
          <div>- Use one rule per line.</div>
          <div>- `*` allows all commands.</div>
          <div>
            - Subcommand rules are prefix matches. `git status` allows `git
            status -sb`, but does not allow `git push`.
          </div>
          <div>- A bare command (for example `git`) allows all its subcommands.</div>
        </div>
        {cliAllowlistActive && cli.allowedCommands.length === 0 && (
          <div style={warn}>
            CLI allowlist is active and empty, so command execution is default deny.
          </div>
        )}
        <div style={{ ...themeLabel, marginBottom: 4, marginTop: 12 }}>Allowed Working Directories (one per line)</div>
        <textarea
          style={textarea}
          value={cli.allowedWorkingDirs.join("\n")}
          disabled={!cliAllowlistActive}
          onChange={(e) =>
            setCli((prev) => ({
              ...prev,
              allowedWorkingDirs: e.target.value.split("\n").filter(Boolean),
            }))
          }
          placeholder="/home/user/projects&#10;*"
        />
        <div style={help}>
          <div>
            - `*` allows any working directory when CLI allowlist enforcement is active.
          </div>
        </div>
      </div>

      <div style={card}>
        <div style={sectionTitle}>Web / Playwright</div>
        <div style={help}>
          Enforcement:
          <span
            style={{
              ...statusBadge,
              background: webAllowlistActive ? "rgba(239,68,68,0.15)" : "rgba(34,197,94,0.15)",
              color: webAllowlistActive ? colors.error : colors.success,
            }}
          >
            {webAllowlistActive ? "active (default deny)" : "inactive (default allow)"}
          </span>
        </div>
        <div style={{ ...themeLabel, marginBottom: 4, marginTop: 12 }}>Allowed Domains (one per line)</div>
        <textarea
          style={textarea}
          value={web.allowedDomains.join("\n")}
          disabled={!webAllowlistActive}
          onChange={(e) =>
            setWeb((prev) => ({
              ...prev,
              allowedDomains: e.target.value.split("\n").filter(Boolean),
            }))
          }
          placeholder="example.com&#10;docs.example.com&#10;*"
        />
        <div style={help}>
          <div>- Use one domain per line.</div>
          <div>- Subdomains are allowed automatically.</div>
          <div>- `*` allows all domains.</div>
        </div>
        {webAllowlistActive && web.allowedDomains.length === 0 && (
          <div style={warn}>
            Domain allowlist is active and empty, so web navigation is default deny.
          </div>
        )}
        <div style={toggleRow}>
          <span style={toggleLabel}>Headless mode</span>
          <input
            type="checkbox"
            checked={web.headless}
            onChange={() =>
              setWeb((prev) => ({ ...prev, headless: !prev.headless }))
            }
          />
        </div>
      </div>

      <button style={{ ...btnFn("primary"), marginTop: 16 }} onClick={save}>
        {saved ? "Saved!" : "Save Permissions"}
      </button>
      {saveError && <div style={warn}>Save failed: {saveError}</div>}
    </div>
  );
}
