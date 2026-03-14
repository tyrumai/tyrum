import { existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import Store from "electron-store";
import { DesktopNodeConfig, DEFAULT_CONFIG } from "./schema.js";
import { encryptToken } from "./token-store.js";

function getConfigDir(): string {
  return process.env["TYRUM_HOME"] ?? join(homedir(), ".tyrum");
}

function getConfigPath(): string {
  return join(getConfigDir(), "desktop-node.json");
}

function createConfigStore(): Store<Record<string, unknown>> {
  return new Store<Record<string, unknown>>({
    cwd: getConfigDir(),
    name: "desktop-node",
    configFileMode: 0o600,
    clearInvalidConfig: false,
    serialize: (value) => JSON.stringify(value, null, 2),
    deserialize: (value) => JSON.parse(value) as Record<string, unknown>,
  });
}

export function configExists(): boolean {
  return existsSync(getConfigPath());
}

export function loadConfig(): DesktopNodeConfig {
  if (!configExists()) {
    return structuredClone(DEFAULT_CONFIG);
  }

  const parsed = DesktopNodeConfig.parse(createConfigStore().store);
  const normalized = normalizeNodeDeviceConfig(parsed);
  if (normalized !== parsed) {
    saveConfig(normalized);
  }
  return normalized;
}

export function saveConfig(config: DesktopNodeConfig): void {
  const normalized = normalizeNodeDeviceConfig(config);
  createConfigStore().store = normalized as Record<string, unknown>;
}

function normalizeNodeDeviceConfig(config: DesktopNodeConfig): DesktopNodeConfig {
  const nextConfig =
    config.device.enabled === true
      ? config
      : {
          ...config,
          device: {
            ...config.device,
            enabled: true,
          },
        };
  const privateKey = nextConfig.device.privateKey.trim();

  if (privateKey.length === 0) {
    return nextConfig;
  }

  const nextRef = encryptToken(privateKey);
  return {
    ...nextConfig,
    device: {
      ...nextConfig.device,
      privateKeyRef: nextRef,
      privateKey: "",
    },
  };
}
