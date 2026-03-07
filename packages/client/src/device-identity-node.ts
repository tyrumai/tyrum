import {
  DeviceIdentityError,
  type DeviceIdentity,
  type DeviceIdentityStorage,
} from "./device-identity.js";

export function createNodeFileDeviceIdentityStorage(path: string): DeviceIdentityStorage {
  return {
    load: async () => {
      const { readFile } = await import("node:fs/promises");
      try {
        const raw = await readFile(path, "utf8");
        let parsed: unknown;
        try {
          parsed = JSON.parse(raw) as unknown;
        } catch (error) {
          throw new DeviceIdentityError(
            "device_identity_invalid_stored_value",
            "Stored device identity file is not valid JSON",
            { cause: error },
          );
        }
        return parseStoredIdentity(parsed);
      } catch (error) {
        if (error instanceof DeviceIdentityError) {
          throw error;
        }
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
