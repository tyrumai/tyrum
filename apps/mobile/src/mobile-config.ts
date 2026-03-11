import { SecureStorage } from "@aparajita/capacitor-secure-storage";
import { Preferences } from "@capacitor/preferences";
import type { DeviceIdentity, DeviceIdentityStorage } from "@tyrum/client";
import type { MobileHostActionName } from "@tyrum/operator-ui";

export type MobileActionSettings = Record<MobileHostActionName, boolean>;

export type MobileConnectionConfig = {
  httpBaseUrl: string;
  wsUrl: string;
  nodeEnabled: boolean;
  actionSettings: MobileActionSettings;
};

export type MobileBootstrapConfig = MobileConnectionConfig & {
  token: string;
};

const PREFERENCES_GROUP = "TyrumMobile";
const PREFS_CONFIG_KEY = "mobile.config";
const SECURE_TOKEN_KEY = "gateway.token";
const SECURE_OPERATOR_IDENTITY_KEY = "operator.identity";
const SECURE_NODE_IDENTITY_KEY = "node.identity";

const DEFAULT_ACTION_SETTINGS: MobileActionSettings = {
  "location.get_current": true,
  "camera.capture_photo": true,
  "audio.record_clip": true,
};

let storageReadyPromise: Promise<void> | null = null;

function normalizeUrl(value: string): string {
  return value.trim().replace(/\/+$/, "");
}

function ensureStorageReady(): Promise<void> {
  if (storageReadyPromise) return storageReadyPromise;
  storageReadyPromise = (async () => {
    await Preferences.configure({ group: PREFERENCES_GROUP });
    await SecureStorage.setKeyPrefix("tyrum.mobile.");
  })();
  return storageReadyPromise;
}

function parseConnectionConfig(raw: unknown): MobileConnectionConfig | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const record = raw as Record<string, unknown>;
  const httpBaseUrl =
    typeof record["httpBaseUrl"] === "string" ? normalizeUrl(record["httpBaseUrl"]) : "";
  const wsUrl = typeof record["wsUrl"] === "string" ? record["wsUrl"].trim() : "";
  if (!httpBaseUrl || !wsUrl) return null;

  const actionRecord =
    record["actionSettings"] && typeof record["actionSettings"] === "object"
      ? (record["actionSettings"] as Record<string, unknown>)
      : {};

  return {
    httpBaseUrl,
    wsUrl,
    nodeEnabled: record["nodeEnabled"] !== false,
    actionSettings: {
      "location.get_current":
        typeof actionRecord["location.get_current"] === "boolean"
          ? actionRecord["location.get_current"]
          : DEFAULT_ACTION_SETTINGS["location.get_current"],
      "camera.capture_photo":
        typeof actionRecord["camera.capture_photo"] === "boolean"
          ? actionRecord["camera.capture_photo"]
          : DEFAULT_ACTION_SETTINGS["camera.capture_photo"],
      "audio.record_clip":
        typeof actionRecord["audio.record_clip"] === "boolean"
          ? actionRecord["audio.record_clip"]
          : DEFAULT_ACTION_SETTINGS["audio.record_clip"],
    },
  };
}

async function getPreferencesJson(key: string): Promise<unknown> {
  await ensureStorageReady();
  const { value } = await Preferences.get({ key });
  if (!value) return null;
  return JSON.parse(value) as unknown;
}

async function setPreferencesJson(key: string, value: unknown): Promise<void> {
  await ensureStorageReady();
  await Preferences.set({ key, value: JSON.stringify(value) });
}

async function getSecureString(key: string): Promise<string | null> {
  await ensureStorageReady();
  const value = await SecureStorage.getItem(key);
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

async function setSecureString(key: string, value: string): Promise<void> {
  await ensureStorageReady();
  await SecureStorage.setItem(key, value);
}

async function removeSecureString(key: string): Promise<void> {
  await ensureStorageReady();
  await SecureStorage.removeItem(key);
}

export function getDefaultActionSettings(): MobileActionSettings {
  return { ...DEFAULT_ACTION_SETTINGS };
}

export function getDefaultConnectionConfig(): MobileConnectionConfig {
  return {
    httpBaseUrl: "",
    wsUrl: "",
    nodeEnabled: true,
    actionSettings: getDefaultActionSettings(),
  };
}

export async function loadMobileBootstrapConfig(): Promise<MobileBootstrapConfig | null> {
  const [rawConfig, token] = await Promise.all([
    getPreferencesJson(PREFS_CONFIG_KEY),
    getSecureString(SECURE_TOKEN_KEY),
  ]);
  const config = parseConnectionConfig(rawConfig);
  if (!config || !token) return null;
  return { ...config, token };
}

export async function saveMobileBootstrapConfig(input: MobileBootstrapConfig): Promise<void> {
  const config: MobileConnectionConfig = {
    httpBaseUrl: normalizeUrl(input.httpBaseUrl),
    wsUrl: input.wsUrl.trim(),
    nodeEnabled: input.nodeEnabled,
    actionSettings: { ...input.actionSettings },
  };
  await Promise.all([
    setPreferencesJson(PREFS_CONFIG_KEY, config),
    setSecureString(SECURE_TOKEN_KEY, input.token.trim()),
  ]);
}

export async function clearMobileBootstrapConfig(): Promise<void> {
  await ensureStorageReady();
  await Promise.all([
    Preferences.remove({ key: PREFS_CONFIG_KEY }),
    removeSecureString(SECURE_TOKEN_KEY),
  ]);
}

export async function updateMobileConnectionConfig(
  current: MobileBootstrapConfig,
  next: Partial<MobileConnectionConfig>,
): Promise<MobileBootstrapConfig> {
  const updated: MobileBootstrapConfig = {
    ...current,
    ...next,
    actionSettings: next.actionSettings
      ? { ...next.actionSettings }
      : { ...current.actionSettings },
  };
  await saveMobileBootstrapConfig(updated);
  return updated;
}

function createSecureDeviceIdentityStorage(key: string): DeviceIdentityStorage {
  return {
    load: async () => {
      await ensureStorageReady();
      const value = await SecureStorage.get(key);
      if (!value || typeof value !== "object" || Array.isArray(value)) {
        return null;
      }
      const record = value as Record<string, unknown>;
      const deviceId = typeof record["deviceId"] === "string" ? record["deviceId"] : "";
      const publicKey = typeof record["publicKey"] === "string" ? record["publicKey"] : "";
      const privateKey = typeof record["privateKey"] === "string" ? record["privateKey"] : "";
      if (!deviceId || !publicKey || !privateKey) {
        return null;
      }
      return { deviceId, publicKey, privateKey };
    },
    save: async (identity: DeviceIdentity) => {
      await ensureStorageReady();
      await SecureStorage.set(key, identity as unknown as Record<string, unknown>);
    },
  };
}

export function createOperatorIdentityStorage(): DeviceIdentityStorage {
  return createSecureDeviceIdentityStorage(SECURE_OPERATOR_IDENTITY_KEY);
}

export function createNodeIdentityStorage(): DeviceIdentityStorage {
  return createSecureDeviceIdentityStorage(SECURE_NODE_IDENTITY_KEY);
}
