import {
  readFileSync,
  writeFileSync,
  mkdirSync,
  existsSync,
  chmodSync,
} from "node:fs";
import { join, dirname } from "node:path";
import { homedir } from "node:os";
import { DesktopNodeConfig, DEFAULT_CONFIG } from "./schema.js";
import { encryptToken } from "./token-store.js";

function getConfigDir(): string {
  return process.env["TYRUM_HOME"] ?? join(homedir(), ".tyrum");
}

function getConfigPath(): string {
  return join(getConfigDir(), "desktop-node.json");
}

export function configExists(): boolean {
  return existsSync(getConfigPath());
}

export function loadConfig(): DesktopNodeConfig {
  const path = getConfigPath();
  if (!existsSync(path)) return structuredClone(DEFAULT_CONFIG);
  const raw = readFileSync(path, "utf-8");
  const parsed = DesktopNodeConfig.parse(JSON.parse(raw));
  const normalized = normalizeDevicePrivateKey(parsed);
  if (normalized !== parsed) {
    saveConfig(normalized);
  }
  return normalized;
}

export function saveConfig(config: DesktopNodeConfig): void {
  const path = getConfigPath();
  mkdirSync(dirname(path), { recursive: true });
  const normalized = normalizeDevicePrivateKey(config);
  writeFileSync(path, JSON.stringify(normalized, null, 2), { mode: 0o600 });
  chmodSync(path, 0o600);
}

function normalizeDevicePrivateKey(config: DesktopNodeConfig): DesktopNodeConfig {
  const privateKey = config.device.privateKey.trim();
  const privateKeyRef = config.device.privateKeyRef.trim();

  if (privateKey.length === 0) {
    return config;
  }

  const nextRef = privateKeyRef.length > 0 ? privateKeyRef : encryptToken(privateKey);
  return {
    ...config,
    device: {
      ...config.device,
      privateKeyRef: nextRef,
      privateKey: "",
    },
  };
}
