import type { CSSProperties } from "react";
import type { DesktopThemeState } from "../shared/theme.js";

export type { DesktopThemeState };

type ThemeTokens = {
  bg: string;
  bgSubtle: string;
  bgCard: string;
  fg: string;
  fgMuted: string;
  border: string;
  primary: string;
  primaryDim: string;
  success: string;
  warning: string;
  error: string;
  neutral: string;
  focusRing: string;
  selection: string;
};

export const desktopThemeTokens = {
  light: {
    bg: "#ffffff",
    bgSubtle: "#f3f4f6",
    bgCard: "#ffffff",
    fg: "#111827",
    fgMuted: "#6b7280",
    border: "#e5e7eb",
    primary: "#4f46e5",
    primaryDim: "rgba(79, 70, 229, 0.12)",
    success: "#16a34a",
    warning: "#ca8a04",
    error: "#dc2626",
    neutral: "#6b7280",
    focusRing: "#4f46e5",
    selection: "rgba(79, 70, 229, 0.20)",
  },
  dark: {
    bg: "#000000",
    bgSubtle: "#0a0a0a",
    bgCard: "#111111",
    fg: "#ededed",
    fgMuted: "#a1a1aa",
    border: "#262626",
    primary: "#6366f1",
    primaryDim: "rgba(99, 102, 241, 0.12)",
    success: "#22c55e",
    warning: "#eab308",
    error: "#ef4444",
    neutral: "#9ca3af",
    focusRing: "#a5b4fc",
    selection: "rgba(99, 102, 241, 0.30)",
  },
} as const satisfies Record<DesktopThemeState["colorScheme"], ThemeTokens>;

function resolveThemeTokens(state: DesktopThemeState): ThemeTokens {
  const base = desktopThemeTokens[state.colorScheme];
  if (!state.highContrast) {
    return base;
  }

  return {
    ...base,
    fgMuted: base.fg,
    border: base.fg,
  };
}

export function applyDesktopThemeState(state: DesktopThemeState): void {
  const root = document.documentElement;
  root.dataset.theme = state.colorScheme;
  const tokens = resolveThemeTokens(state);

  root.style.setProperty("--tyrum-color-bg", tokens.bg);
  root.style.setProperty("--tyrum-color-bg-subtle", tokens.bgSubtle);
  root.style.setProperty("--tyrum-color-bg-card", tokens.bgCard);
  root.style.setProperty("--tyrum-color-fg", tokens.fg);
  root.style.setProperty("--tyrum-color-fg-muted", tokens.fgMuted);
  root.style.setProperty("--tyrum-color-border", tokens.border);
  root.style.setProperty("--tyrum-color-primary", tokens.primary);
  root.style.setProperty("--tyrum-color-primary-dim", tokens.primaryDim);
  root.style.setProperty("--tyrum-color-success", tokens.success);
  root.style.setProperty("--tyrum-color-warning", tokens.warning);
  root.style.setProperty("--tyrum-color-error", tokens.error);
  root.style.setProperty("--tyrum-color-neutral", tokens.neutral);
  root.style.setProperty("--tyrum-color-focus-ring", tokens.focusRing);
  root.style.setProperty("--tyrum-color-selection", tokens.selection);
}

export interface DesktopThemeBridge {
  getState: () => Promise<DesktopThemeState>;
  onChange: (cb: (state: DesktopThemeState) => void) => () => void;
}

export async function startDesktopThemeSync(bridge: DesktopThemeBridge): Promise<() => void> {
  let receivedUpdate = false;
  const unsubscribe = bridge.onChange((state) => {
    receivedUpdate = true;
    applyDesktopThemeState(state);
  });

  const initialState = await bridge.getState();
  if (!receivedUpdate) {
    applyDesktopThemeState(initialState);
  }
  return unsubscribe;
}

export const colors = {
  bg: "var(--tyrum-color-bg)",
  bgSubtle: "var(--tyrum-color-bg-subtle)",
  bgCard: "var(--tyrum-color-bg-card)",
  fg: "var(--tyrum-color-fg)",
  fgMuted: "var(--tyrum-color-fg-muted)",
  border: "var(--tyrum-color-border)",
  primary: "var(--tyrum-color-primary)",
  primaryDim: "var(--tyrum-color-primary-dim)",
  success: "var(--tyrum-color-success)",
  warning: "var(--tyrum-color-warning)",
  error: "var(--tyrum-color-error)",
  neutral: "var(--tyrum-color-neutral)",
} as const;

export const fonts = {
  sans: 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, "Noto Sans", "Apple Color Emoji", "Segoe UI Emoji", "Segoe UI Symbol", sans-serif',
  mono: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
} as const;

export const STATUS_COLORS: Record<string, string> = {
  running: colors.success,
  starting: colors.warning,
  error: colors.error,
  stopped: colors.neutral,
};

export const card: CSSProperties = {
  background: colors.bgCard,
  borderRadius: 8,
  padding: 20,
  marginBottom: 16,
  border: `1px solid ${colors.border}`,
};

export const heading: CSSProperties = {
  fontSize: 22,
  fontWeight: 700,
  marginBottom: 20,
  color: colors.fg,
};

export const label: CSSProperties = {
  fontSize: 12,
  fontWeight: 600,
  color: colors.fgMuted,
  textTransform: "uppercase",
  letterSpacing: "0.05em",
  marginBottom: 4,
};

export const sectionTitle: CSSProperties = {
  fontSize: 15,
  fontWeight: 600,
  marginBottom: 12,
  color: colors.fg,
};

export const value: CSSProperties = {
  fontSize: 16,
  fontWeight: 500,
  marginBottom: 16,
  color: colors.fg,
};

export const info: CSSProperties = {
  fontSize: 13,
  color: colors.fgMuted,
  marginTop: 8,
};

export const help: CSSProperties = {
  fontSize: 12,
  color: colors.fgMuted,
  lineHeight: 1.5,
  marginTop: 8,
};

export const warn: CSSProperties = {
  fontSize: 12,
  color: colors.error,
  marginTop: 8,
};

export function statusDot(color: string): CSSProperties {
  return {
    display: "inline-block",
    width: 10,
    height: 10,
    borderRadius: "50%",
    background: color,
    marginRight: 8,
    verticalAlign: "middle",
  };
}

export function btn(variant: "primary" | "secondary" | "danger"): CSSProperties {
  const palette = {
    primary: { bg: colors.primary, color: "#fff" },
    secondary: { bg: "transparent", color: colors.fg },
    danger: { bg: colors.error, color: "#fff" },
  };
  const p = palette[variant];
  return {
    padding: "8px 20px",
    borderRadius: 6,
    border: variant === "secondary" ? `1px solid ${colors.border}` : "1px solid transparent",
    fontSize: 14,
    fontWeight: 600,
    cursor: "pointer",
    background: p.bg,
    color: p.color,
    fontFamily: fonts.sans,
  };
}

export const badge: CSSProperties = {
  display: "inline-block",
  padding: "4px 10px",
  borderRadius: 12,
  background: colors.primaryDim,
  color: colors.primary,
  fontSize: 12,
  fontWeight: 600,
  marginRight: 6,
  marginBottom: 6,
};

export const input: CSSProperties = {
  width: "100%",
  padding: "8px 12px",
  borderRadius: 6,
  border: `1px solid ${colors.border}`,
  background: colors.bgSubtle,
  color: colors.fg,
  fontSize: 14,
  fontFamily: "inherit",
  boxSizing: "border-box",
};

export const textarea: CSSProperties = {
  width: "100%",
  minHeight: 80,
  borderRadius: 6,
  border: `1px solid ${colors.border}`,
  background: colors.bgSubtle,
  color: colors.fg,
  padding: 8,
  fontSize: 13,
  fontFamily: fonts.mono,
  resize: "vertical",
  boxSizing: "border-box",
  marginTop: 4,
};

export const tabRow: CSSProperties = {
  display: "flex",
  gap: 0,
  marginBottom: 16,
  borderBottom: `1px solid ${colors.border}`,
};

export function tab(active: boolean): CSSProperties {
  return {
    padding: "10px 20px",
    cursor: "pointer",
    fontSize: 14,
    fontWeight: active ? 600 : 400,
    color: active ? colors.primary : colors.fgMuted,
    background: "none",
    border: "none",
    borderBottomStyle: "solid",
    borderBottomWidth: 2,
    borderBottomColor: active ? colors.primary : "transparent",
    marginBottom: -1,
    fontFamily: fonts.sans,
  };
}

export const toggleRow: CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  padding: "8px 0",
  borderBottom: `1px solid ${colors.border}`,
};

export const toggleLabel: CSSProperties = {
  fontSize: 14,
  color: colors.fg,
};

export const labelRow: CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 12,
  padding: "6px 0",
  borderBottom: `1px solid ${colors.border}`,
};

export const labelKey: CSSProperties = {
  fontSize: 12,
  color: colors.fgMuted,
  textTransform: "uppercase",
  letterSpacing: "0.04em",
};

export const labelValue: CSSProperties = {
  fontSize: 13,
  color: colors.fg,
  fontWeight: 600,
};

export const statusBadge: CSSProperties = {
  display: "inline-block",
  fontSize: 12,
  fontWeight: 700,
  borderRadius: 999,
  padding: "3px 10px",
  marginLeft: 8,
};
