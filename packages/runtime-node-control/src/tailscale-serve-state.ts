import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

const STATE_VERSION = 1;
const STATE_RELATIVE_PATH = join("runtime-state", "tailscale-serve.json");

export const TAILSCALE_ADMIN_MACHINES_URL = "https://login.tailscale.com/admin/machines";

export interface ManagedTailscaleServeState {
  version: 1;
  publicUrl: string;
  previousPublicBaseUrl: string;
  dnsName: string;
  target: {
    host: string;
    port: number;
  };
  serveSnapshotCanonical: string;
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((entry) => stableValue(entry));
  }
  if (!value || typeof value !== "object") {
    return value;
  }

  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .toSorted(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => [key, stableValue(entry)]),
  );
}

export function canonicalizeJson(value: unknown): string {
  return JSON.stringify(stableValue(value));
}

export function resolveTailscaleServeStatePath(home: string): string {
  return join(home, STATE_RELATIVE_PATH);
}

export async function readManagedTailscaleServeState(
  home: string,
): Promise<ManagedTailscaleServeState | null> {
  try {
    const raw = JSON.parse(await readFile(resolveTailscaleServeStatePath(home), "utf8")) as unknown;
    if (!raw || typeof raw !== "object") {
      return null;
    }

    const record = raw as Record<string, unknown>;
    const target =
      record["target"] && typeof record["target"] === "object"
        ? (record["target"] as Record<string, unknown>)
        : null;
    if (
      record["version"] !== STATE_VERSION ||
      typeof record["publicUrl"] !== "string" ||
      typeof record["previousPublicBaseUrl"] !== "string" ||
      typeof record["dnsName"] !== "string" ||
      !target ||
      typeof target["host"] !== "string" ||
      typeof target["port"] !== "number" ||
      typeof record["serveSnapshotCanonical"] !== "string"
    ) {
      return null;
    }

    return {
      version: STATE_VERSION,
      publicUrl: record["publicUrl"],
      previousPublicBaseUrl: record["previousPublicBaseUrl"],
      dnsName: record["dnsName"],
      target: {
        host: target["host"],
        port: target["port"],
      },
      serveSnapshotCanonical: record["serveSnapshotCanonical"],
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException | undefined)?.code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

export async function writeManagedTailscaleServeState(
  home: string,
  state: Omit<ManagedTailscaleServeState, "version">,
): Promise<void> {
  const path = resolveTailscaleServeStatePath(home);
  await mkdir(join(home, "runtime-state"), { recursive: true, mode: 0o700 });
  await writeFile(path, `${JSON.stringify({ version: STATE_VERSION, ...state }, null, 2)}\n`, {
    mode: 0o600,
  });
}

export async function clearManagedTailscaleServeState(home: string): Promise<void> {
  await rm(resolveTailscaleServeStatePath(home), { force: true });
}
