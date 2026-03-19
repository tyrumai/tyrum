import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { deviceIdFromSha256Digest } from "@tyrum/contracts";

type StoredDeviceIdentity = {
  deviceId: string;
  publicKey: string;
  privateKey: string;
};

function isStoredDeviceIdentity(value: unknown): value is StoredDeviceIdentity {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record["deviceId"] === "string" &&
    typeof record["publicKey"] === "string" &&
    typeof record["privateKey"] === "string"
  );
}

async function createDeviceIdentity(): Promise<StoredDeviceIdentity> {
  const keyPair = await crypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"]);
  const publicKeyDer = Buffer.from(await crypto.subtle.exportKey("spki", keyPair.publicKey));
  const privateKeyDer = Buffer.from(await crypto.subtle.exportKey("pkcs8", keyPair.privateKey));
  const digest = createHash("sha256").update(publicKeyDer).digest();

  return {
    deviceId: deviceIdFromSha256Digest(digest),
    publicKey: publicKeyDer.toString("base64url"),
    privateKey: privateKeyDer.toString("base64url"),
  };
}

export async function loadOrCreateDesktopEnvironmentIdentity(
  identityPath: string,
): Promise<StoredDeviceIdentity> {
  try {
    const raw = await readFile(identityPath, "utf8");
    const parsed = JSON.parse(raw) as unknown;
    if (isStoredDeviceIdentity(parsed)) return parsed;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException | undefined)?.code;
    if (code !== "ENOENT") throw error;
  }

  const identity = await createDeviceIdentity();
  await mkdir(dirname(identityPath), { recursive: true, mode: 0o700 });
  await writeFile(identityPath, `${JSON.stringify(identity, null, 2)}\n`, { mode: 0o600 });
  return identity;
}
