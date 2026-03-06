import { ipcMain, nativeTheme, shell } from "electron";
import { configExists, loadConfig, saveConfig } from "../config/store.js";
import { DesktopNodeConfig } from "../config/schema.js";
import {
  checkMacPermissions,
  requestMacPermission,
  type MacPermissionKind,
} from "../platform/permissions.js";
import { normalizeConfigPartialForSave } from "../config/token-ref-normalizer.js";
import { notifyBackgroundConfigChanged } from "../background-mode.js";

const RENDERER_MUTABLE_PATHS = new Set([
  "mode",
  "theme.source",
  "remote.wsUrl",
  "remote.tokenRef",
  "remote.tlsCertFingerprint256",
  "remote.tlsAllowSelfSigned",
  "embedded.port",
  "embedded.dbPath",
  "permissions.profile",
  "capabilities.desktop",
  "capabilities.playwright",
  "capabilities.cli",
  "capabilities.http",
  "cli.allowedCommands",
  "cli.allowedWorkingDirs",
  "web.allowedDomains",
  "web.headless",
  "permissions.overrides",
]);

/**
 * Recursively filter an object to only include keys whose dot-paths
 * appear in `allowed`. Sub-objects whose path is listed are kept whole;
 * otherwise we recurse and keep only the allowed leaves.
 */
export function filterMutableKeys(
  partial: Record<string, unknown>,
  allowed: ReadonlySet<string>,
  prefix = "",
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const key of Object.keys(partial)) {
    const dotPath = prefix ? `${prefix}.${key}` : key;
    const value = partial[key];
    if (value !== null && typeof value === "object" && !Array.isArray(value)) {
      // Check if the entire sub-object path is allowed (e.g. "permissions.overrides")
      if (allowed.has(dotPath)) {
        result[key] = value;
      } else {
        // Recurse into nested objects
        const filtered = filterMutableKeys(value as Record<string, unknown>, allowed, dotPath);
        if (Object.keys(filtered).length > 0) {
          result[key] = filtered;
        }
      }
    } else {
      // Leaf value — only include if the dot-path is allowlisted
      if (allowed.has(dotPath)) {
        result[key] = value;
      }
    }
  }
  return result;
}

let ipcRegistered = false;

/** Recursively merge `source` into `target`, preserving nested fields. */
function deepMerge(
  target: Record<string, unknown>,
  source: Record<string, unknown>,
): Record<string, unknown> {
  const result = { ...target };
  for (const key of Object.keys(source)) {
    const src = source[key];
    const tgt = result[key];
    if (
      src !== null &&
      typeof src === "object" &&
      !Array.isArray(src) &&
      tgt !== null &&
      typeof tgt === "object" &&
      !Array.isArray(tgt)
    ) {
      result[key] = deepMerge(tgt as Record<string, unknown>, src as Record<string, unknown>);
    } else {
      result[key] = src;
    }
  }
  return result;
}

function sanitizeConfigForRenderer(config: DesktopNodeConfig): DesktopNodeConfig {
  return {
    ...config,
    device: {
      ...config.device,
      privateKey: "",
      privateKeyRef: "",
    },
  };
}

export function registerConfigIpc(): void {
  if (ipcRegistered) return;
  ipcRegistered = true;

  ipcMain.handle("config:get", () => {
    return sanitizeConfigForRenderer(loadConfig());
  });

  ipcMain.handle("config:exists", () => {
    return configExists();
  });

  ipcMain.handle("config:set", (_event, partial: unknown) => {
    if (partial === null || typeof partial !== "object" || Array.isArray(partial)) {
      throw new Error("config:set requires a plain object");
    }
    const filtered = filterMutableKeys(partial as Record<string, unknown>, RENDERER_MUTABLE_PATHS);
    const current = loadConfig();
    const normalizedPartial = normalizeConfigPartialForSave(filtered);
    const merged = DesktopNodeConfig.parse(
      deepMerge(current as unknown as Record<string, unknown>, normalizedPartial),
    );
    saveConfig(merged);
    notifyBackgroundConfigChanged(merged);
    nativeTheme.themeSource = merged.theme.source;
    return sanitizeConfigForRenderer(merged);
  });

  ipcMain.handle("permissions:check-mac", () => {
    return checkMacPermissions();
  });

  ipcMain.handle("permissions:request-mac", (_event, permission: unknown) => {
    if (permission !== "accessibility" && permission !== "screenRecording") {
      throw new Error("permissions:request-mac requires 'accessibility' or 'screenRecording'");
    }
    return requestMacPermission(permission as MacPermissionKind);
  });

  ipcMain.handle("shell:open-external", async (_event, rawUrl: unknown) => {
    if (typeof rawUrl !== "string") {
      throw new Error("shell:open-external requires a URL string");
    }

    let parsed: URL;
    try {
      parsed = new URL(rawUrl);
    } catch {
      throw new Error(`Invalid URL: ${rawUrl}`);
    }

    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      throw new Error("Only http/https URLs are allowed for external open");
    }

    await shell.openExternal(parsed.toString());
  });
}
