import {
  inferGatewayWsUrl,
  normalizeGatewayHttpBaseUrl,
  type MobileBootstrapPayload,
} from "@tyrum/contracts";
import { SecureStorage } from "@aparajita/capacitor-secure-storage";
import { Preferences } from "@capacitor/preferences";
import {
  parseStoredDeviceIdentity,
  type DeviceIdentity,
  type DeviceIdentityStorage,
} from "@tyrum/transport-sdk";
import type { MobileHostActionName } from "@tyrum/operator-ui";

export type MobileActionSettings = Record<MobileHostActionName, boolean>;

export type MobileLocationStreamingConfig = {
  streamEnabled: boolean;
  distanceFilterM: number;
  maxIntervalMs: number;
  maxAccuracyM: number;
  backgroundEnabled: boolean;
};

export type MobileConnectionConfig = {
  httpBaseUrl: string;
  wsUrl: string;
  nodeEnabled: boolean;
  actionSettings: MobileActionSettings;
  locationStreaming: MobileLocationStreamingConfig;
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
  get: true,
  capture_photo: true,
  record: true,
};

const DEFAULT_LOCATION_STREAMING_CONFIG: MobileLocationStreamingConfig = {
  streamEnabled: true,
  distanceFilterM: 100,
  maxIntervalMs: 900_000,
  maxAccuracyM: 100,
  backgroundEnabled: false,
};

let storageReadyPromise: Promise<void> | null = null;

export function normalizeHttpBaseUrl(value: string): string {
  return normalizeGatewayHttpBaseUrl(value);
}

export function normalizeWsUrl(value: string): string {
  return value.trim();
}
export { inferGatewayWsUrl };

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
    typeof record["httpBaseUrl"] === "string" ? normalizeHttpBaseUrl(record["httpBaseUrl"]) : "";
  const wsUrl = typeof record["wsUrl"] === "string" ? normalizeWsUrl(record["wsUrl"]) : "";
  if (!httpBaseUrl || !wsUrl) return null;

  const actionRecord =
    record["actionSettings"] && typeof record["actionSettings"] === "object"
      ? (record["actionSettings"] as Record<string, unknown>)
      : {};
  const streamingRecord =
    record["locationStreaming"] && typeof record["locationStreaming"] === "object"
      ? (record["locationStreaming"] as Record<string, unknown>)
      : {};

  return {
    httpBaseUrl,
    wsUrl,
    nodeEnabled: record["nodeEnabled"] !== false,
    actionSettings: {
      get:
        typeof actionRecord["get"] === "boolean"
          ? actionRecord["get"]
          : DEFAULT_ACTION_SETTINGS["get"],
      capture_photo:
        typeof actionRecord["capture_photo"] === "boolean"
          ? actionRecord["capture_photo"]
          : DEFAULT_ACTION_SETTINGS["capture_photo"],
      record:
        typeof actionRecord["record"] === "boolean"
          ? actionRecord["record"]
          : DEFAULT_ACTION_SETTINGS["record"],
    },
    locationStreaming: {
      streamEnabled:
        typeof streamingRecord["streamEnabled"] === "boolean"
          ? streamingRecord["streamEnabled"]
          : DEFAULT_LOCATION_STREAMING_CONFIG.streamEnabled,
      distanceFilterM:
        typeof streamingRecord["distanceFilterM"] === "number" &&
        Number.isFinite(streamingRecord["distanceFilterM"]) &&
        streamingRecord["distanceFilterM"] > 0
          ? Math.round(streamingRecord["distanceFilterM"])
          : DEFAULT_LOCATION_STREAMING_CONFIG.distanceFilterM,
      maxIntervalMs:
        typeof streamingRecord["maxIntervalMs"] === "number" &&
        Number.isFinite(streamingRecord["maxIntervalMs"]) &&
        streamingRecord["maxIntervalMs"] > 0
          ? Math.round(streamingRecord["maxIntervalMs"])
          : DEFAULT_LOCATION_STREAMING_CONFIG.maxIntervalMs,
      maxAccuracyM:
        typeof streamingRecord["maxAccuracyM"] === "number" &&
        Number.isFinite(streamingRecord["maxAccuracyM"]) &&
        streamingRecord["maxAccuracyM"] > 0
          ? Math.round(streamingRecord["maxAccuracyM"])
          : DEFAULT_LOCATION_STREAMING_CONFIG.maxAccuracyM,
      backgroundEnabled:
        typeof streamingRecord["backgroundEnabled"] === "boolean"
          ? streamingRecord["backgroundEnabled"]
          : DEFAULT_LOCATION_STREAMING_CONFIG.backgroundEnabled,
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

export function getDefaultLocationStreamingConfig(): MobileLocationStreamingConfig {
  return { ...DEFAULT_LOCATION_STREAMING_CONFIG };
}

export function mobileBootstrapConfigFromPayload(
  payload: MobileBootstrapPayload,
): MobileBootstrapConfig {
  return {
    httpBaseUrl: normalizeHttpBaseUrl(payload.httpBaseUrl),
    wsUrl: normalizeWsUrl(payload.wsUrl),
    token: payload.token.trim(),
    nodeEnabled: true,
    actionSettings: getDefaultActionSettings(),
    locationStreaming: getDefaultLocationStreamingConfig(),
  };
}

export function sameMobileBootstrapConfig(
  left: Pick<MobileBootstrapConfig, "httpBaseUrl" | "wsUrl" | "token">,
  right: Pick<MobileBootstrapConfig, "httpBaseUrl" | "wsUrl" | "token">,
): boolean {
  return (
    normalizeHttpBaseUrl(left.httpBaseUrl) === normalizeHttpBaseUrl(right.httpBaseUrl) &&
    normalizeWsUrl(left.wsUrl) === normalizeWsUrl(right.wsUrl) &&
    left.token.trim() === right.token.trim()
  );
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
    httpBaseUrl: normalizeHttpBaseUrl(input.httpBaseUrl),
    wsUrl: normalizeWsUrl(input.wsUrl),
    nodeEnabled: input.nodeEnabled,
    actionSettings: { ...input.actionSettings },
    locationStreaming: { ...input.locationStreaming },
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
    locationStreaming: next.locationStreaming
      ? { ...next.locationStreaming }
      : { ...current.locationStreaming },
  };
  await saveMobileBootstrapConfig(updated);
  return updated;
}

function createSecureDeviceIdentityStorage(key: string): DeviceIdentityStorage {
  return {
    load: async () => {
      await ensureStorageReady();
      const value = await SecureStorage.get(key);
      return parseStoredDeviceIdentity(value);
    },
    save: async (identity: DeviceIdentity) => {
      await ensureStorageReady();
      await SecureStorage.set(key, {
        deviceId: identity.deviceId,
        publicKey: identity.publicKey,
        privateKey: identity.privateKey,
      });
    },
  };
}

export function createOperatorIdentityStorage(): DeviceIdentityStorage {
  return createSecureDeviceIdentityStorage(SECURE_OPERATOR_IDENTITY_KEY);
}

export function createNodeIdentityStorage(): DeviceIdentityStorage {
  return createSecureDeviceIdentityStorage(SECURE_NODE_IDENTITY_KEY);
}
