import {
  CAPABILITY_DESCRIPTOR_DEFAULT_VERSION,
  descriptorIdsForClientCapability,
  deviceIdFromSha256Digest,
  migrateCapabilityDescriptorId,
  type CapabilityDescriptor,
  type ClientCapability,
  type WsCapabilityReadyPayload,
} from "@tyrum/contracts";
import {
  TyrumClient,
  createManagedNodeClientLifecycle,
  type CapabilityProvider,
  type ManagedNodeClientLifecycle,
} from "@tyrum/node-sdk/node";
import type { DesktopNodeConfig } from "./config/schema.js";
import type { ResolvedPermissions } from "./config/permissions.js";
import { saveConfig } from "./config/store.js";
import { decryptToken, encryptToken } from "./config/token-store.js";
import { createHash, generateKeyPairSync } from "node:crypto";
import { platform as osPlatform } from "node:os";

function computeDeviceId(pubkeyDer: Buffer): string {
  const digest = createHash("sha256").update(pubkeyDer).digest();
  return deviceIdFromSha256Digest(digest);
}

/** Maps `process.platform` to the canonical `DevicePlatform` value. */
function resolveDevicePlatform(): "macos" | "windows" | "linux" {
  switch (osPlatform()) {
    case "darwin":
      return "macos";
    case "win32":
      return "windows";
    default:
      return "linux";
  }
}

export interface NodeRuntimeCallbacks {
  onStatusChange: (status: { connected: boolean; code?: number; reason?: string }) => void;
  onPlanUpdate: (msg: unknown) => void;
  onLog: (entry: { level: string; message: string; timestamp: string }) => void;
}

export class NodeRuntime {
  private lifecycle: ManagedNodeClientLifecycle<TyrumClient> | null = null;
  private providers: CapabilityProvider[] = [];
  private config: DesktopNodeConfig;
  private currentDeviceId: string | null = null;

  constructor(
    config: DesktopNodeConfig,
    private _permissions: ResolvedPermissions,
    private callbacks: NodeRuntimeCallbacks,
  ) {
    this.config = config;
  }

  get connected(): boolean {
    return this.lifecycle?.client.connected ?? false;
  }

  get permissions(): ResolvedPermissions {
    return this._permissions;
  }

  get deviceId(): string | null {
    return this.currentDeviceId;
  }

  registerProvider(provider: CapabilityProvider): void {
    this.providers.push(provider);
  }

  private ensureDeviceIdentity(): DesktopNodeConfig["device"] {
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

    this.currentDeviceId = deviceId || null;

    return {
      ...current,
      enabled: true,
      deviceId,
      publicKey,
      privateKeyRef,
      privateKey,
    };
  }

  /**
   * Collects the canonical capability descriptor IDs from all registered providers.
   * Migrates legacy IDs to canonical form.
   */
  private getAdvertisedCapabilityDescriptors(): CapabilityDescriptor[] {
    const seen = new Set<string>();
    const descriptors: CapabilityDescriptor[] = [];
    for (const provider of this.providers) {
      const ids: readonly string[] =
        provider.capabilityIds ??
        (provider.capability
          ? descriptorIdsForClientCapability(provider.capability as ClientCapability).flatMap(
              migrateCapabilityDescriptorId,
            )
          : []);
      for (const id of ids) {
        if (!seen.has(id)) {
          seen.add(id);
          descriptors.push({ id, version: CAPABILITY_DESCRIPTOR_DEFAULT_VERSION });
        }
      }
    }
    return descriptors;
  }

  private getCapabilityReadyPayload(): WsCapabilityReadyPayload {
    return {
      capabilities: this.getAdvertisedCapabilityDescriptors(),
      capability_states: [],
    };
  }

  connect(wsUrl: string, token: string): void {
    if (this.lifecycle) {
      this.lifecycle.dispose();
      this.lifecycle = null;
    }

    const advertisedDescriptors = this.getAdvertisedCapabilityDescriptors();

    // Legacy capabilities array — still required by TyrumClient for backward compat
    const legacyCapabilities = this.getEnabledLegacyCapabilities();

    const device = this.ensureDeviceIdentity();
    const tlsCertFingerprint256Raw =
      this.config.mode === "remote" ? this.config.remote.tlsCertFingerprint256.trim() : "";
    const tlsCertFingerprint256 =
      tlsCertFingerprint256Raw.length > 0 ? tlsCertFingerprint256Raw : undefined;
    const tlsAllowSelfSigned =
      this.config.mode === "remote" ? Boolean(this.config.remote.tlsAllowSelfSigned) : false;
    const client = new TyrumClient({
      url: wsUrl,
      token,
      tlsCertFingerprint256,
      tlsAllowSelfSigned,
      capabilities: legacyCapabilities,
      advertisedCapabilities: advertisedDescriptors,
      role: "node",
      device: {
        publicKey: device.publicKey,
        privateKey: device.privateKey,
        deviceId: device.deviceId.trim().length > 0 ? device.deviceId : undefined,
        label: device.label.trim().length > 0 ? device.label : undefined,
        platform: device.platform.trim().length > 0 ? device.platform : undefined,
        version: device.version.trim().length > 0 ? device.version : undefined,
        mode: device.mode.trim().length > 0 ? device.mode : undefined,
        device_type: "desktop",
        device_platform: resolveDevicePlatform(),
      },
    });

    this.lifecycle = createManagedNodeClientLifecycle({
      client,
      getCapabilityReadyPayload: () => this.getCapabilityReadyPayload(),
      providers: this.providers,
      onConnected: () => {
        this.callbacks.onStatusChange({ connected: true });
        this.callbacks.onLog({
          level: "info",
          message: `Connected to gateway at ${wsUrl} as ${device.deviceId}`,
          timestamp: new Date().toISOString(),
        });
      },
      onDisconnected: (info) => {
        this.callbacks.onStatusChange({
          connected: false,
          code: info.code,
          reason: info.reason,
        });
        this.callbacks.onLog({
          level: "info",
          message: `Disconnected from gateway (code: ${info.code})`,
          timestamp: new Date().toISOString(),
        });
      },
      onTransportError: (msg) => {
        this.callbacks.onLog({
          level: "error",
          message: `Transport error: ${msg.message}`,
          timestamp: new Date().toISOString(),
        });
      },
    });

    // Forward events that were previously registered directly on the client
    client.on("plan_update", (msg: unknown) => {
      this.callbacks.onPlanUpdate(msg);
    });

    client.on("error", (msg: { payload: { message: string } }) => {
      this.callbacks.onLog({
        level: "error",
        message: `Gateway error: ${msg.payload.message}`,
        timestamp: new Date().toISOString(),
      });
    });

    this.lifecycle.connect();
  }

  /** Re-publish capability state (e.g. after operator toggles capabilities). */
  async publishCapabilityState(): Promise<void> {
    await this.lifecycle?.publishCapabilityState();
  }

  disconnect(): void {
    this.lifecycle?.dispose();
    this.lifecycle = null;
  }

  /**
   * @deprecated Legacy capability list for TyrumClient backward compat.
   * Returns deduplicated `ClientCapability` values from providers that still
   * declare the old `capability` field.
   */
  private getEnabledLegacyCapabilities(): ClientCapability[] {
    const caps = new Set<ClientCapability>();
    for (const provider of this.providers) {
      if (provider.capability) {
        caps.add(provider.capability as ClientCapability);
      }
    }
    return [...caps];
  }
}
