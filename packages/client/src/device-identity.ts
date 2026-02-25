import { deviceIdFromSha256Digest } from "@tyrum/schemas";

export interface DeviceIdentity {
  deviceId: string;
  publicKey: string;
  privateKey: string;
}

export interface DeviceIdentityStorage {
  load: () => Promise<DeviceIdentity | null> | DeviceIdentity | null;
  save: (identity: DeviceIdentity) => Promise<void> | void;
}

export type DeviceIdentityErrorCode =
  | "device_identity_webcrypto_unavailable"
  | "device_identity_invalid_stored_value"
  | "device_identity_storage_load_failed"
  | "device_identity_storage_save_failed";

export class DeviceIdentityError extends Error {
  readonly code: DeviceIdentityErrorCode;

  constructor(code: DeviceIdentityErrorCode, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "DeviceIdentityError";
    this.code = code;
  }
}

export function formatDeviceIdentityError(error: unknown): string {
  if (error instanceof DeviceIdentityError) {
    return `${error.code}: ${error.message}`;
  }
  if (error instanceof Error) return error.message;
  return String(error);
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const buf = bytes.buffer;
  if (buf instanceof ArrayBuffer) {
    return buf.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  }
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

function toBase64UrlBytes(value: Uint8Array): string {
  if (typeof Buffer !== "undefined") {
    return Buffer.from(value).toString("base64url");
  }
  let binary = "";
  for (const b of value) {
    binary += String.fromCharCode(b);
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function fromBase64Url(value: string): Uint8Array {
  if (typeof Buffer !== "undefined") {
    return Buffer.from(value, "base64url");
  }
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function getSubtleCrypto(): SubtleCrypto {
  if (!globalThis.crypto?.subtle) {
    throw new DeviceIdentityError(
      "device_identity_webcrypto_unavailable",
      "WebCrypto subtle API not available",
    );
  }
  return globalThis.crypto.subtle;
}

async function sha256(bytes: Uint8Array): Promise<Uint8Array> {
  const digest = await getSubtleCrypto().digest("SHA-256", toArrayBuffer(bytes));
  return new Uint8Array(digest);
}

export async function computeDeviceIdFromPublicKeyDer(publicKeyDer: Uint8Array): Promise<string> {
  const digest = await sha256(publicKeyDer);
  return deviceIdFromSha256Digest(digest);
}

async function exportPublicKeySpki(publicKey: CryptoKey): Promise<Uint8Array> {
  const spki = await getSubtleCrypto().exportKey("spki", publicKey);
  return new Uint8Array(spki);
}

async function exportPrivateKeyPkcs8(privateKey: CryptoKey): Promise<Uint8Array> {
  const pkcs8 = await getSubtleCrypto().exportKey("pkcs8", privateKey);
  return new Uint8Array(pkcs8);
}

function parseStoredIdentity(value: unknown): DeviceIdentity | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "object") {
    throw new DeviceIdentityError(
      "device_identity_invalid_stored_value",
      "Stored device identity must be an object",
    );
  }
  const raw = value as Record<string, unknown>;
  const deviceId = typeof raw.deviceId === "string" ? raw.deviceId.trim() : "";
  const publicKey = typeof raw.publicKey === "string" ? raw.publicKey.trim() : "";
  const privateKey = typeof raw.privateKey === "string" ? raw.privateKey.trim() : "";
  if (!deviceId || !publicKey || !privateKey) {
    throw new DeviceIdentityError(
      "device_identity_invalid_stored_value",
      "Stored device identity is missing required fields",
    );
  }
  return { deviceId, publicKey, privateKey };
}

export async function createDeviceIdentity(): Promise<DeviceIdentity> {
  const keyPair = await getSubtleCrypto().generateKey({ name: "Ed25519" }, true, ["sign", "verify"]);
  const publicKeyDer = await exportPublicKeySpki(keyPair.publicKey);
  const privateKeyDer = await exportPrivateKeyPkcs8(keyPair.privateKey);
  return {
    deviceId: await computeDeviceIdFromPublicKeyDer(publicKeyDer),
    publicKey: toBase64UrlBytes(publicKeyDer),
    privateKey: toBase64UrlBytes(privateKeyDer),
  };
}

export async function loadOrCreateDeviceIdentity(
  storage: DeviceIdentityStorage,
): Promise<DeviceIdentity> {
  let loadedRaw: DeviceIdentity | null;
  try {
    loadedRaw = await storage.load();
  } catch (error) {
    throw new DeviceIdentityError("device_identity_storage_load_failed", "Failed to load device identity", {
      cause: error,
    });
  }
  const loaded = parseStoredIdentity(loadedRaw);
  if (loaded) return loaded;
  const created = await createDeviceIdentity();
  try {
    await storage.save(created);
  } catch (error) {
    throw new DeviceIdentityError("device_identity_storage_save_failed", "Failed to save device identity", {
      cause: error,
    });
  }
  return created;
}

export function createBrowserLocalStorageDeviceIdentityStorage(
  key = "tyrum.client.deviceIdentity",
): DeviceIdentityStorage {
  return {
    load: () => {
      if (typeof localStorage === "undefined") return null;
      const raw = localStorage.getItem(key);
      if (raw === null) return null;
      const parsed = JSON.parse(raw) as unknown;
      return parseStoredIdentity(parsed);
    },
    save: (identity) => {
      if (typeof localStorage === "undefined") {
        throw new DeviceIdentityError(
          "device_identity_storage_save_failed",
          "localStorage is not available in this runtime",
        );
      }
      localStorage.setItem(key, JSON.stringify(identity));
    },
  };
}

export function createNodeFileDeviceIdentityStorage(path: string): DeviceIdentityStorage {
  return {
    load: async () => {
      const { readFile } = await import("node:fs/promises");
      try {
        const raw = await readFile(path, "utf8");
        const parsed = JSON.parse(raw) as unknown;
        return parseStoredIdentity(parsed);
      } catch (error) {
        const asErr = error as NodeJS.ErrnoException;
        if (asErr?.code === "ENOENT") return null;
        throw error;
      }
    },
    save: async (identity) => {
      const { mkdir, writeFile } = await import("node:fs/promises");
      const { dirname } = await import("node:path");
      await mkdir(dirname(path), { recursive: true, mode: 0o700 });
      await writeFile(path, `${JSON.stringify(identity, null, 2)}\n`, { mode: 0o600 });
    },
  };
}

export function buildConnectProofTranscript(input: {
  protocolRev: number;
  role: "client" | "node";
  deviceId: string;
  connectionId: string;
  challenge: string;
}): Uint8Array {
  const text =
    `tyrum-connect-proof\n` +
    `protocol_rev=${String(input.protocolRev)}\n` +
    `role=${input.role}\n` +
    `device_id=${input.deviceId}\n` +
    `connection_id=${input.connectionId}\n` +
    `challenge=${input.challenge}\n`;
  return new TextEncoder().encode(text);
}

export async function signProofWithPrivateKey(
  privateKey: string,
  transcript: Uint8Array,
): Promise<string> {
  const key = await getSubtleCrypto().importKey(
    "pkcs8",
    toArrayBuffer(fromBase64Url(privateKey)),
    { name: "Ed25519" },
    false,
    ["sign"],
  );
  const signature = await getSubtleCrypto().sign(
    { name: "Ed25519" },
    key,
    toArrayBuffer(transcript),
  );
  return toBase64UrlBytes(new Uint8Array(signature));
}
