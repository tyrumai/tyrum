import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import { createNodeFileDeviceIdentityStorage, normalizeFingerprint256 } from "@tyrum/client";

import {
  resolveOperatorConfigPath,
  resolveOperatorDeviceIdentityPath,
  resolveOperatorElevatedModePath,
} from "./operator-paths.js";

export async function loadOperatorConfig(path: string): Promise<{
  gateway_url?: string;
  auth_token?: string;
  tls_cert_fingerprint256?: string;
  tls_allow_self_signed?: boolean;
}> {
  try {
    const raw = await readFile(path, "utf8");
    const parsed = JSON.parse(raw) as unknown;
    if (parsed === null || typeof parsed !== "object") {
      throw new Error("config file must be a JSON object");
    }
    const asRecord = parsed as Record<string, unknown>;
    const gatewayUrl =
      typeof asRecord.gateway_url === "string" ? asRecord.gateway_url.trim() : undefined;
    const authToken =
      typeof asRecord.auth_token === "string" ? asRecord.auth_token.trim() : undefined;
    const tlsFingerprintRaw =
      typeof asRecord.tls_cert_fingerprint256 === "string"
        ? asRecord.tls_cert_fingerprint256.trim()
        : "";
    let tlsFingerprint: string | undefined;
    if (tlsFingerprintRaw) {
      const normalized = normalizeFingerprint256(tlsFingerprintRaw);
      if (!normalized) {
        throw new Error("config.tls_cert_fingerprint256 must be a SHA-256 hex fingerprint");
      }
      tlsFingerprint = normalized;
    }
    const tlsAllowSelfSigned =
      typeof asRecord.tls_allow_self_signed === "boolean"
        ? asRecord.tls_allow_self_signed
        : undefined;
    return {
      gateway_url: gatewayUrl,
      auth_token: authToken,
      tls_cert_fingerprint256: tlsFingerprint,
      tls_allow_self_signed: tlsAllowSelfSigned,
    };
  } catch (error) {
    const asErr = error as NodeJS.ErrnoException;
    if (asErr?.code === "ENOENT") return {};
    throw error;
  }
}

export async function saveOperatorConfig(
  path: string,
  config: {
    gateway_url: string;
    auth_token: string;
    tls_cert_fingerprint256?: string;
    tls_allow_self_signed?: boolean;
  },
): Promise<void> {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  await writeFile(path, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
}

export type PersistedElevatedModeState = {
  elevatedToken: string;
  expiresAt: string;
};

export function requireIsoDateTimeMs(raw: string, label: string): number {
  const ms = Date.parse(raw);
  if (!Number.isFinite(ms)) {
    throw new Error(`${label} must be a valid ISO datetime string`);
  }
  return ms;
}

export function formatRemainingMs(remainingMs: number): string {
  const totalSeconds = Math.ceil(Math.max(0, remainingMs) / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes)}:${String(seconds).padStart(2, "0")}`;
}

export async function loadOperatorElevatedModeState(
  path: string,
): Promise<PersistedElevatedModeState | null> {
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch (error) {
    const asErr = error as NodeJS.ErrnoException;
    if (asErr?.code === "ENOENT") return null;
    throw error;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch (error) {
    throw new Error(`elevated mode state must be valid JSON: path=${path}`, { cause: error });
  }

  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`elevated mode state must be a JSON object: path=${path}`);
  }

  const record = parsed as Record<string, unknown>;
  const elevatedToken = typeof record.elevatedToken === "string" ? record.elevatedToken.trim() : "";
  const expiresAt = typeof record.expiresAt === "string" ? record.expiresAt.trim() : "";
  if (!elevatedToken || !expiresAt) {
    throw new Error(`elevated mode state missing elevatedToken/expiresAt: path=${path}`);
  }

  const expiresAtMs = requireIsoDateTimeMs(expiresAt, "elevated mode expiresAt");
  if (expiresAtMs <= Date.now()) {
    await rm(path, { force: true });
    return null;
  }

  return { elevatedToken, expiresAt };
}

export async function saveOperatorElevatedModeState(
  path: string,
  state: PersistedElevatedModeState,
): Promise<void> {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  await writeFile(path, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
}

export async function clearOperatorElevatedModeState(path: string): Promise<void> {
  await rm(path, { force: true });
}

export async function requireElevatedModeToken(
  home: string,
  override: string | undefined,
): Promise<string> {
  const explicit = override?.trim();
  if (explicit) return explicit;

  const statePath = resolveOperatorElevatedModePath(home);
  const state = await loadOperatorElevatedModeState(statePath);
  if (state) return state.elevatedToken;

  throw new Error(
    "Elevated Mode required: run 'tyrum-cli elevated-mode enter' " +
      "or pass --elevated-token <token> explicitly for this command.",
  );
}

export async function requireOperatorConfig(home: string): Promise<{
  gateway_url: string;
  auth_token: string;
  tls_cert_fingerprint256?: string;
  tls_allow_self_signed?: boolean;
}> {
  const configPath = resolveOperatorConfigPath(home);
  const config = await loadOperatorConfig(configPath);
  const gatewayUrl = config.gateway_url?.trim();
  const authToken = config.auth_token?.trim();
  if (!gatewayUrl || !authToken) {
    throw new Error(
      `operator config is missing gateway_url/token: run 'tyrum-cli config set --gateway-url <url> --token <token>' path=${configPath}`,
    );
  }
  const tlsCertFingerprint256 = config.tls_cert_fingerprint256;
  const tlsAllowSelfSigned = Boolean(config.tls_allow_self_signed);
  if (tlsAllowSelfSigned && !tlsCertFingerprint256) {
    throw new Error(
      `operator config is missing tls_cert_fingerprint256 required by tls_allow_self_signed: path=${configPath}`,
    );
  }
  return {
    gateway_url: gatewayUrl,
    auth_token: authToken,
    ...(tlsCertFingerprint256 ? { tls_cert_fingerprint256: tlsCertFingerprint256 } : {}),
    ...(tlsAllowSelfSigned ? { tls_allow_self_signed: true } : {}),
  };
}

export async function requireOperatorDeviceIdentity(home: string): Promise<{
  deviceId: string;
  publicKey: string;
  privateKey: string;
}> {
  const identityPath = resolveOperatorDeviceIdentityPath(home);
  const storage = createNodeFileDeviceIdentityStorage(identityPath);
  const identity = await storage.load();
  if (!identity) {
    throw new Error(`device identity missing: run 'tyrum-cli identity init' path=${identityPath}`);
  }
  return identity;
}
