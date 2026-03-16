import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import type { DesktopBackgroundState } from "../../../desktop-api.js";

// ─── Platform ────────────────────────────────────────────────────────────────

export type PlatformKind = "desktop" | "browser" | "mobile";

// ─── Auto-save status ────────────────────────────────────────────────────────

export type SaveStatus = "idle" | "saving" | "saved" | "error";

// ─── Unified model (returned by each platform adapter) ──────────────────────

export interface UnifiedNodeConfigModel {
  platform: PlatformKind;
  loading: boolean;
  loadError: string | null;
  connection: NodeConnectionInfo;
  executor: NodeExecutorState;
  capabilities: NormalizedCapability[];
}

// ─── Node executor (master toggle) ──────────────────────────────────────────

export interface NodeExecutorState {
  enabled: boolean;
  status: "connected" | "connecting" | "disconnected" | "disabled" | "error";
  nodeId: string | null;
  error: string | null;
  busy: boolean;
  onToggle: (enabled: boolean) => void;
}

// ─── Connection section ─────────────────────────────────────────────────────

export type NodeConnectionInfo =
  | { mode: "readonly"; gatewayUrl?: string; platform?: string }
  | { mode: "editable"; editable: DesktopConnectionFields };

export interface DesktopConnectionFields {
  connectionMode: "embedded" | "remote";
  port: number;
  remoteUrl: string;
  remoteToken: string;
  remoteTlsCertFingerprint256: string;
  remoteTlsAllowSelfSigned: boolean;
  hasSavedRemoteToken: boolean;
  currentToken: string | null;
  currentTokenLoading: boolean;
  currentTokenError: string | null;
  backgroundState: DesktopBackgroundState | null;
  backgroundBusy: boolean;
  backgroundError: string | null;

  onConnectionModeChange: (mode: "embedded" | "remote") => void;
  onPortChange: (port: number) => void;
  onRemoteUrlChange: (url: string) => void;
  onRemoteTokenChange: (token: string) => void;
  onRemoteTlsFingerprintChange: (fingerprint: string) => void;
  onRemoteTlsAllowSelfSignedChange: (allow: boolean) => void;
  onToggleBackgroundMode: (enabled: boolean) => void;

  /** True when connection settings have changed from saved state. */
  dirty: boolean;
  saving: boolean;
  saved: boolean;
  saveError: string | null;
  /** Persist connection settings (may trigger restart confirmation). */
  onSave: () => void;
}

// ─── Capability (the core reusable unit) ────────────────────────────────────

export interface NormalizedCapability {
  /** Stable identifier, e.g. "desktop", "cli", "browser.location". */
  key: string;
  label: string;
  description: string;
  icon: LucideIcon;
  enabled: boolean;
  onToggle: (enabled: boolean) => void;
  /** One-line status for collapsed view. */
  statusSummary: string;
  /** Save status for the capability toggle itself. */
  saveStatus: SaveStatus;
  saveError: string | null;
  /** Sub-actions within this capability. */
  actions: CapabilityAction[];
  /** Allowlist config fields. */
  allowlists: CapabilityAllowlist[];
  /** Toggle config fields (e.g. headless mode). */
  toggles: CapabilityToggle[];
  /** Test action definitions. */
  testActions: CapabilityTestAction[];
  /** Extra rendered content (e.g. macOS permissions panel). */
  extraContent?: ReactNode;
}

// ─── Sub-action ─────────────────────────────────────────────────────────────

export interface CapabilityAction {
  name: string;
  label: string;
  description: string;
  enabled: boolean;
  availabilityStatus: "unknown" | "available" | "unavailable";
  unavailableReason?: string;
  sensitiveDataCategory?: "none" | "location" | "image" | "audio" | "screen" | "ui";
  onToggle: (enabled: boolean) => void;
}

// ─── Allowlist ──────────────────────────────────────────────────────────────

export interface CapabilityAllowlist {
  key: string;
  label: string;
  /** Whether the allowlist is actively enforced (default deny). */
  active: boolean;
  /** Current value, newline-separated entries. */
  value: string;
  placeholder: string;
  notes: string[];
  warningTitle?: string;
  warningDescription?: string;
  showWarning: boolean;
  saveStatus: SaveStatus;
  saveError: string | null;
  onChange: (value: string) => void;
}

// ─── Config toggle ──────────────────────────────────────────────────────────

export interface CapabilityToggle {
  key: string;
  label: string;
  description: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}

// ─── Test action ────────────────────────────────────────────────────────────

export interface CapabilityTestAction {
  label: string;
  actionName: string;
  available: boolean;
  onRun: () => Promise<unknown>;
}

// ─── Capability catalog entry (static metadata) ────────────────────────────

export interface CapabilityCatalogEntry {
  key: string;
  label: string;
  description: string;
  icon: LucideIcon;
  platforms: readonly PlatformKind[];
}
