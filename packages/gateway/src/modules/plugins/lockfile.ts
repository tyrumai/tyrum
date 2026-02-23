import { PluginLockFile } from "@tyrum/schemas";
import type { PluginLockFile as PluginLockFileT } from "@tyrum/schemas";
import { createHash } from "node:crypto";

export const PLUGIN_LOCK_FORMAT = "tyrum.plugin.lock.v1" as const;
export const PLUGIN_LOCK_FILENAME = "plugin.lock.json" as const;

export type PluginInstallInfo = {
  pinned_version: string;
  integrity_sha256: string;
  recorded_at?: string;
  source?: Record<string, unknown>;
};

export function pluginIntegritySha256Hex(manifestRaw: string, entryRaw: string): string {
  return createHash("sha256")
    .update("manifest\0")
    .update(manifestRaw)
    .update("\0entry\0")
    .update(entryRaw)
    .digest("hex");
}

export function parsePluginLockFile(raw: string): PluginInstallInfo | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    return undefined;
  }
  const validated = PluginLockFile.safeParse(parsed);
  if (!validated.success) return undefined;
  const data = validated.data as PluginLockFileT;
  return {
    pinned_version: data.pinned_version,
    integrity_sha256: data.integrity_sha256,
    recorded_at: data.recorded_at,
    source: data.source,
  };
}

export function renderPluginLockFile(value: {
  pinned_version: string;
  integrity_sha256: string;
  recorded_at: string;
  source?: Record<string, unknown>;
}): string {
  return JSON.stringify(
    {
      format: PLUGIN_LOCK_FORMAT,
      recorded_at: value.recorded_at,
      source: value.source,
      pinned_version: value.pinned_version,
      integrity_sha256: value.integrity_sha256,
    },
    null,
    2,
  );
}
