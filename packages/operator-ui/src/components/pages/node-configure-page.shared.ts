import {
  capabilitiesForProfile,
  type CapFlags,
  type Profile,
} from "../../utils/permission-profile.js";

export interface CliConfig {
  allowedCommands: string[];
  allowedWorkingDirs: string[];
}

export interface WebConfig {
  allowedDomains: string[];
  headless: boolean;
}

export interface AllowlistDraftState {
  browserDomains: string;
  cliCommands: string;
  cliWorkingDirs: string;
}

export interface SecurityState {
  profile: Profile;
  overrides: Record<string, boolean>;
  capabilities: CapFlags;
  cli: CliConfig;
  web: WebConfig;
}

export interface ConnectionState {
  mode: "embedded" | "remote";
  port: number;
  remoteUrl: string;
  remoteToken: string;
  remoteTlsCertFingerprint256: string;
  remoteTlsAllowSelfSigned: boolean;
  hasSavedRemoteToken: boolean;
}

export interface MacPermissionSnapshot {
  accessibility: boolean | null;
  screenRecording: boolean | null;
  instructions?: string;
}

export const DEFAULT_PROFILE: Profile = "balanced";
// Preserve the historical restrictive fallback until the stored config provides capabilities.
export const DEFAULT_CAPABILITIES = capabilitiesForProfile("safe");
export const DEFAULT_CLI_CONFIG: CliConfig = { allowedCommands: [], allowedWorkingDirs: [] };
export const DEFAULT_WEB_CONFIG: WebConfig = { allowedDomains: [], headless: true };

export const SHELL_COMMAND_NOTES = [
  "- Use one rule per line.",
  "- `*` allows all commands.",
  "- Subcommand rules are prefix matches. `git status` allows `git status -sb`, but not `git push`.",
  "- A bare command such as `git` allows all its subcommands.",
];

export const SHELL_DIRECTORY_NOTES = [
  "- Use one directory per line.",
  "- `*` allows any working directory when the allowlist is active.",
];

export const BROWSER_DOMAIN_NOTES = [
  "- Use one domain per line.",
  "- Subdomains are allowed automatically.",
  "- `*` allows all domains.",
];

export function readSecurityState(config: unknown): SecurityState {
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

export function readConnectionState(config: unknown): ConnectionState {
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

export function hasConnectionSettingsChanged(
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

export function needsEmbeddedGatewayRestart(
  initialState: ConnectionState,
  currentState: ConnectionState,
): boolean {
  return initialState.mode === "embedded" || currentState.mode === "embedded";
}

export function validateConnectionState(state: ConnectionState): string | null {
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

export function buildConnectionSavePartial(connection: ConnectionState) {
  const partial: Record<string, unknown> = {
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

export function cloneSecurityState(state: SecurityState): SecurityState {
  return {
    profile: state.profile,
    overrides: { ...state.overrides },
    capabilities: { ...state.capabilities },
    cli: cloneCliConfig(state.cli),
    web: cloneWebConfig(state.web),
  };
}

export function cloneConnectionState(state: ConnectionState): ConnectionState {
  return { ...state };
}

export function cloneCliConfig(config: CliConfig): CliConfig {
  return {
    allowedCommands: [...config.allowedCommands],
    allowedWorkingDirs: [...config.allowedWorkingDirs],
  };
}

export function cloneWebConfig(config: WebConfig): WebConfig {
  return {
    allowedDomains: [...config.allowedDomains],
    headless: config.headless,
  };
}

export function createAllowlistDraftState(security: SecurityState): AllowlistDraftState {
  return {
    browserDomains: joinAllowlistLines(security.web.allowedDomains),
    cliCommands: joinAllowlistLines(security.cli.allowedCommands),
    cliWorkingDirs: joinAllowlistLines(security.cli.allowedWorkingDirs),
  };
}

export function describeMacPermissionSummary(snapshot: MacPermissionSnapshot | null): string {
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

export function splitAllowlistLines(value: string): string[] {
  return value
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}
