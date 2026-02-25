import { TyrumClient, autoExecute } from "@tyrum/client";
import type { CapabilityProvider } from "@tyrum/client";
import { deviceIdFromSha256Digest, type ClientCapability } from "@tyrum/schemas";
import type { DesktopNodeConfig } from "./config/schema.js";
import type { ResolvedPermissions } from "./config/permissions.js";
import { saveConfig } from "./config/store.js";
import { decryptToken, encryptToken } from "./config/token-store.js";
import { createHash, generateKeyPairSync } from "node:crypto";

function computeDeviceId(pubkeyDer: Buffer): string {
  const digest = createHash("sha256").update(pubkeyDer).digest();
  return deviceIdFromSha256Digest(digest);
}

function envForcesNodeRole(): boolean {
  const raw = process.env["TYRUM_DESKTOP_NODE_ROLE"]?.trim().toLowerCase();
  return Boolean(raw && ["1", "true", "yes", "on", "node"].includes(raw));
}

export interface NodeRuntimeCallbacks {
  onStatusChange: (status: { connected: boolean; code?: number; reason?: string }) => void;
  onConsentRequest: (msg: unknown) => void;
  onPlanUpdate: (msg: unknown) => void;
  onLog: (entry: { level: string; message: string; timestamp: string }) => void;
}

export class NodeRuntime {
  private client: TyrumClient | null = null;
  private providers: CapabilityProvider[] = [];
  private config: DesktopNodeConfig;

  constructor(
    config: DesktopNodeConfig,
    private _permissions: ResolvedPermissions,
    private callbacks: NodeRuntimeCallbacks,
  ) {
    this.config = config;
  }

  get connected(): boolean {
    return this.client?.connected ?? false;
  }

  get permissions(): ResolvedPermissions {
    return this._permissions;
  }

  registerProvider(provider: CapabilityProvider): void {
    this.providers.push(provider);
  }

  private ensureDeviceIdentity(): DesktopNodeConfig["device"] | undefined {
    if (!envForcesNodeRole() && !this.config.device.enabled) return undefined;

    const current = this.config.device;
    let publicKey = current.publicKey.trim();
    let privateKeyRef = current.privateKeyRef.trim();
    const legacyPrivateKey = current.privateKey.trim();
    let deviceId = current.deviceId.trim();

    let privateKey = "";
    let shouldSave = false;

    if (privateKeyRef) {
      try {
        privateKey = decryptToken(privateKeyRef).trim();
      } catch {
        privateKeyRef = "";
      }
    }

    if (!privateKey && legacyPrivateKey) {
      privateKey = legacyPrivateKey;
      privateKeyRef = encryptToken(privateKey);
      shouldSave = true;
    }

    if (!publicKey || !privateKey || !privateKeyRef) {
      const { publicKey: pub, privateKey: priv } = generateKeyPairSync("ed25519");
      const pubDer = pub.export({ format: "der", type: "spki" }) as Buffer;
      const privDer = priv.export({ format: "der", type: "pkcs8" }) as Buffer;
      publicKey = pubDer.toString("base64url");
      privateKey = privDer.toString("base64url");
      privateKeyRef = encryptToken(privateKey);
      deviceId = computeDeviceId(pubDer);
      shouldSave = true;
    }

    try {
      const pubDer = Buffer.from(publicKey, "base64url");
      if (pubDer.length > 0) {
        const expectedDeviceId = computeDeviceId(pubDer);
        if (!deviceId || deviceId !== expectedDeviceId) {
          deviceId = expectedDeviceId;
          shouldSave = true;
        }
      }
    } catch {
      // ignore — client will compute device id if omitted
    }

    if (shouldSave) {
      this.config = {
        ...this.config,
        device: {
          ...current,
          enabled: true,
          deviceId,
          publicKey,
          privateKeyRef,
          privateKey: "",
        },
      };
      saveConfig(this.config);
    }

    return {
      ...current,
      enabled: true,
      deviceId,
      publicKey,
      privateKeyRef,
      privateKey,
    };
  }

  connect(wsUrl: string, token: string): void {
    if (this.client) {
      this.client.disconnect();
    }

    const capabilities = this.getEnabledCapabilities();

    const device = this.ensureDeviceIdentity();
    const tlsCertFingerprint256Raw =
      this.config.mode === "remote" ? this.config.remote.tlsCertFingerprint256.trim() : "";
    const tlsCertFingerprint256 =
      tlsCertFingerprint256Raw.length > 0 ? tlsCertFingerprint256Raw : undefined;
    this.client = new TyrumClient({
      url: wsUrl,
      token,
      tlsCertFingerprint256,
      capabilities,
      role: device ? "node" : "client",
      device: device
        ? {
            publicKey: device.publicKey,
            privateKey: device.privateKey,
            deviceId: device.deviceId.trim().length > 0 ? device.deviceId : undefined,
            label: device.label.trim().length > 0 ? device.label : undefined,
            platform: device.platform.trim().length > 0 ? device.platform : undefined,
            version: device.version.trim().length > 0 ? device.version : undefined,
            mode: device.mode.trim().length > 0 ? device.mode : undefined,
          }
        : undefined,
    });

    this.client.on("connected", () => {
      this.callbacks.onStatusChange({ connected: true });
      this.callbacks.onLog({
        level: "info",
        message: `Connected to gateway at ${wsUrl}${device ? ` as ${device.deviceId}` : ""}`,
        timestamp: new Date().toISOString(),
      });
    });

    this.client.on("disconnected", (info) => {
      this.callbacks.onStatusChange({ connected: false, ...info });
      this.callbacks.onLog({
        level: "info",
        message: `Disconnected from gateway (code: ${info.code})`,
        timestamp: new Date().toISOString(),
      });
    });

    this.client.on("approval_request", (msg) => {
      this.callbacks.onConsentRequest(msg);
    });

    this.client.on("plan_update", (msg) => {
      this.callbacks.onPlanUpdate(msg);
    });

    this.client.on("error", (msg) => {
      this.callbacks.onLog({
        level: "error",
        message: `Gateway error: ${msg.payload.message}`,
        timestamp: new Date().toISOString(),
      });
    });

    this.client.on("transport_error", (msg) => {
      this.callbacks.onLog({
        level: "error",
        message: `Transport error: ${msg.message}`,
        timestamp: new Date().toISOString(),
      });
    });

    if (this.providers.length > 0) {
      autoExecute(this.client, this.providers);
    }

    this.client.connect();
  }

  disconnect(): void {
    this.client?.disconnect();
    this.client = null;
  }

  respondToConsent(requestId: string, approved: boolean, reason?: string): void {
    this.client?.respondApprovalRequest(requestId, approved, reason);
  }

  private getEnabledCapabilities(): ClientCapability[] {
    return [...new Set(this.providers.map((provider) => provider.capability))];
  }
}
