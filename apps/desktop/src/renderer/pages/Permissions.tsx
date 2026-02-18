import { useEffect, useMemo, useState } from "react";
import { toErrorMessage } from "../lib/errors.js";
import {
  capabilitiesForProfile,
  getAllowlistMode,
  type CapFlags,
  type Profile,
} from "../lib/permission-profile.js";

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

const cardStyle: React.CSSProperties = {
  background: "#ffffff",
  borderRadius: 8,
  padding: 20,
  marginBottom: 16,
  boxShadow: "0 1px 4px rgba(0,0,0,0.08)",
};

const headingStyle: React.CSSProperties = {
  fontSize: 22,
  fontWeight: 700,
  marginBottom: 20,
};

const sectionTitle: React.CSSProperties = {
  fontSize: 15,
  fontWeight: 600,
  marginBottom: 12,
  color: "#374151",
};

const radioLabelStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "flex-start",
  gap: 10,
  padding: "10px 12px",
  borderRadius: 6,
  cursor: "pointer",
  marginBottom: 4,
};

function radioLabelActiveStyle(active: boolean): React.CSSProperties {
  return {
    ...radioLabelStyle,
    background: active ? "#eef2ff" : "transparent",
    border: active ? "1px solid #c7d2fe" : "1px solid transparent",
  };
}

const descStyle: React.CSSProperties = {
  fontSize: 12,
  color: "#6b7280",
  lineHeight: 1.4,
  marginTop: 2,
};

const toggleRowStyle: React.CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  padding: "8px 0",
  borderBottom: "1px solid #f3f4f6",
};

const toggleLabelStyle: React.CSSProperties = {
  fontSize: 14,
  color: "#374151",
};

const textareaStyle: React.CSSProperties = {
  width: "100%",
  minHeight: 80,
  borderRadius: 6,
  border: "1px solid #d1d5db",
  padding: 8,
  fontSize: 13,
  fontFamily: "monospace",
  resize: "vertical",
  boxSizing: "border-box",
  marginTop: 4,
};

const labelStyle: React.CSSProperties = {
  fontSize: 13,
  fontWeight: 600,
  color: "#374151",
  marginBottom: 4,
  marginTop: 12,
};

const btnStyle: React.CSSProperties = {
  padding: "8px 20px",
  borderRadius: 6,
  border: "none",
  fontSize: 14,
  fontWeight: 600,
  cursor: "pointer",
  background: "#6c63ff",
  color: "#fff",
  marginTop: 16,
};

const statusBadgeStyle: React.CSSProperties = {
  display: "inline-block",
  fontSize: 12,
  fontWeight: 700,
  borderRadius: 999,
  padding: "3px 10px",
  marginLeft: 8,
};

const helpStyle: React.CSSProperties = {
  fontSize: 12,
  color: "#6b7280",
  lineHeight: 1.5,
  marginTop: 8,
};

const warningStyle: React.CSSProperties = {
  fontSize: 12,
  color: "#b91c1c",
  marginTop: 8,
};

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
      <h1 style={headingStyle}>Permissions</h1>

      <div style={cardStyle}>
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
              <div style={descStyle}>{p.description}</div>
            </div>
          </label>
        ))}
      </div>

      <div style={cardStyle}>
        <div style={sectionTitle}>Capabilities</div>
        <div style={helpStyle}>
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
          <div key={key} style={toggleRowStyle}>
            <span style={toggleLabelStyle}>{label}</span>
            <input
              type="checkbox"
              checked={capabilities[key]}
              onChange={() => toggleCap(key)}
            />
          </div>
        ))}
      </div>

      <div style={cardStyle}>
        <div style={sectionTitle}>CLI Allowlist</div>
        <div style={helpStyle}>
          Enforcement:
          <span
            style={{
              ...statusBadgeStyle,
              background: cliAllowlistActive ? "#fee2e2" : "#dcfce7",
              color: cliAllowlistActive ? "#b91c1c" : "#166534",
            }}
          >
            {cliAllowlistActive ? "active (default deny)" : "inactive (default allow)"}
          </span>
        </div>
        <div style={labelStyle}>Allowed Commands (one per line)</div>
        <textarea
          style={textareaStyle}
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
        <div style={helpStyle}>
          <div>- Use one rule per line.</div>
          <div>- `*` allows all commands.</div>
          <div>
            - Subcommand rules are prefix matches. `git status` allows `git
            status -sb`, but does not allow `git push`.
          </div>
          <div>- A bare command (for example `git`) allows all its subcommands.</div>
        </div>
        {cliAllowlistActive && cli.allowedCommands.length === 0 && (
          <div style={warningStyle}>
            CLI allowlist is active and empty, so command execution is default deny.
          </div>
        )}
        <div style={labelStyle}>Allowed Working Directories (one per line)</div>
        <textarea
          style={textareaStyle}
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
        <div style={helpStyle}>
          <div>
            - `*` allows any working directory when CLI allowlist enforcement is active.
          </div>
        </div>
      </div>

      <div style={cardStyle}>
        <div style={sectionTitle}>Web / Playwright</div>
        <div style={helpStyle}>
          Enforcement:
          <span
            style={{
              ...statusBadgeStyle,
              background: webAllowlistActive ? "#fee2e2" : "#dcfce7",
              color: webAllowlistActive ? "#b91c1c" : "#166534",
            }}
          >
            {webAllowlistActive ? "active (default deny)" : "inactive (default allow)"}
          </span>
        </div>
        <div style={labelStyle}>Allowed Domains (one per line)</div>
        <textarea
          style={textareaStyle}
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
        <div style={helpStyle}>
          <div>- Use one domain per line.</div>
          <div>- Subdomains are allowed automatically.</div>
          <div>- `*` allows all domains.</div>
        </div>
        {webAllowlistActive && web.allowedDomains.length === 0 && (
          <div style={warningStyle}>
            Domain allowlist is active and empty, so web navigation is default deny.
          </div>
        )}
        <div style={toggleRowStyle}>
          <span style={toggleLabelStyle}>Headless mode</span>
          <input
            type="checkbox"
            checked={web.headless}
            onChange={() =>
              setWeb((prev) => ({ ...prev, headless: !prev.headless }))
            }
          />
        </div>
      </div>

      <button style={btnStyle} onClick={save}>
        {saved ? "Saved!" : "Save Permissions"}
      </button>
      {saveError && <div style={warningStyle}>Save failed: {saveError}</div>}
    </div>
  );
}
