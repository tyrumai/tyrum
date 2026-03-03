import { TyrumClient } from "@tyrum/operator-core";
import { Notification } from "electron";
import { configExists, loadConfig } from "./config/store.js";
import { resolveOperatorConnection, startEmbeddedGatewayFromConfig } from "./ipc/gateway-ipc.js";
import {
  registerWorkItemNotificationHandlers,
  type WorkItemNotification,
} from "./work-item-notification-handlers.js";

function showElectronNotification(notification: WorkItemNotification): void {
  try {
    if (!Notification.isSupported()) return;
    const native = new Notification({ title: notification.title, body: notification.body });
    native.on("click", () => {
      notification.onClick();
    });
    native.show();
  } catch (error) {
    console.error("Failed to show work item notification", error);
  }
}

export class WorkItemNotificationService {
  private client: TyrumClient | null = null;
  private disposeHandlers: (() => void) | null = null;
  private started = false;

  constructor(private openDeepLink: (rawUrl: string) => void) {}

  async start(): Promise<void> {
    if (this.started) return;
    if (!configExists()) return;

    try {
      let config = loadConfig();
      if (config.mode === "embedded") {
        await startEmbeddedGatewayFromConfig();
        config = loadConfig();
      }

      const connection = resolveOperatorConnection(config);
      const tlsCertFingerprint256 =
        connection.tlsCertFingerprint256.trim().length > 0
          ? connection.tlsCertFingerprint256
          : undefined;

      const client = new TyrumClient({
        url: connection.wsUrl,
        token: connection.token,
        tlsCertFingerprint256,
        capabilities: [],
        reconnect: true,
        maxReconnectDelay: 10_000,
      });

      const disposeHandlers = registerWorkItemNotificationHandlers(client, {
        notify: showElectronNotification,
        openDeepLink: this.openDeepLink,
      });

      this.client = client;
      this.disposeHandlers = disposeHandlers;

      client.connect();

      this.started = true;
    } catch (error) {
      this.stop();
      console.error("Failed to start work item notifications", error);
    }
  }

  stop(): void {
    this.started = false;
    this.disposeHandlers?.();
    this.disposeHandlers = null;
    this.client?.disconnect();
    this.client = null;
  }
}
