import { TyrumClient, autoExecute } from "@tyrum/client";
import type { CapabilityProvider } from "@tyrum/client";
import type { ClientCapability } from "@tyrum/schemas";
import type { DesktopNodeConfig } from "./config/schema.js";
import type { ResolvedPermissions } from "./config/permissions.js";

export interface NodeRuntimeCallbacks {
  onStatusChange: (status: { connected: boolean; code?: number; reason?: string }) => void;
  onConsentRequest: (msg: unknown) => void;
  onPlanUpdate: (msg: unknown) => void;
  onLog: (entry: { level: string; message: string; timestamp: string }) => void;
}

export class NodeRuntime {
  private client: TyrumClient | null = null;
  private providers: CapabilityProvider[] = [];

  constructor(
    _config: DesktopNodeConfig,
    private _permissions: ResolvedPermissions,
    private callbacks: NodeRuntimeCallbacks,
  ) {}

  get connected(): boolean {
    return this.client?.connected ?? false;
  }

  get permissions(): ResolvedPermissions {
    return this._permissions;
  }

  registerProvider(provider: CapabilityProvider): void {
    this.providers.push(provider);
  }

  connect(wsUrl: string, token: string): void {
    if (this.client) {
      this.client.disconnect();
    }

    const capabilities = this.getEnabledCapabilities();

    this.client = new TyrumClient({ url: wsUrl, token, capabilities });

    this.client.on("connected", () => {
      this.callbacks.onStatusChange({ connected: true });
      this.callbacks.onLog({
        level: "info",
        message: `Connected to gateway at ${wsUrl}`,
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

    this.client.on("human_confirmation", (msg) => {
      this.callbacks.onConsentRequest(msg);
    });

    this.client.on("plan_update", (msg) => {
      this.callbacks.onPlanUpdate(msg);
    });

    this.client.on("error", (msg) => {
      this.callbacks.onLog({
        level: "error",
        message: `Gateway error: ${msg.message}`,
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

  respondToConsent(planId: string, approved: boolean, reason?: string): void {
    this.client?.sendHumanResponse(planId, approved, reason);
  }

  private getEnabledCapabilities(): ClientCapability[] {
    return [...new Set(this.providers.map((provider) => provider.capability))];
  }
}
