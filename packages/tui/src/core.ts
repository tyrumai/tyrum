import {
  TyrumClient,
  createNodeFileDeviceIdentityStorage,
  createTyrumHttpClient,
  loadOrCreateDeviceIdentity,
} from "@tyrum/operator-core";
import {
  createAdminModeStore,
  createBearerTokenAuth,
  createOperatorCore,
  createOperatorCoreManager,
  wsTokenForAuth,
  type OperatorCore,
  type OperatorCoreFactory,
  type OperatorCoreManager,
} from "@tyrum/operator-core";

export type TuiCoreOptions = {
  wsUrl: string;
  httpBaseUrl: string;
  token: string;
  deviceIdentityPath: string;
  tlsCertFingerprint256?: string;
  reconnect?: boolean;
};

export type TuiRuntime = {
  manager: OperatorCoreManager;
  enterAdminMode(adminToken: string, opts?: { ttlSeconds?: number }): Promise<void>;
  exitAdminMode(): void;
  dispose(): void;
};

export async function createTuiCore(options: TuiCoreOptions): Promise<TuiRuntime> {
  const identity = await loadOrCreateDeviceIdentity(
    createNodeFileDeviceIdentityStorage(options.deviceIdentityPath),
  );

  const adminModeStore = createAdminModeStore();

  const createCore: OperatorCoreFactory = (coreOptions): OperatorCore => {
    const ws = new TyrumClient({
      url: coreOptions.wsUrl,
      token: wsTokenForAuth(coreOptions.auth),
      tlsCertFingerprint256: options.tlsCertFingerprint256,
      reconnect: options.reconnect,
      capabilities: [],
      device: {
        publicKey: identity.publicKey,
        privateKey: identity.privateKey,
        deviceId: identity.deviceId,
        label: "tui",
        platform: typeof process !== "undefined" ? process.platform : "unknown",
        version: typeof process !== "undefined" ? process.version : "unknown",
      },
    });

    return createOperatorCore({
      wsUrl: coreOptions.wsUrl,
      httpBaseUrl: coreOptions.httpBaseUrl,
      auth: coreOptions.auth,
      adminModeStore: coreOptions.adminModeStore,
      deps: { ws },
    });
  };

  const manager = createOperatorCoreManager({
    wsUrl: options.wsUrl,
    httpBaseUrl: options.httpBaseUrl,
    baselineAuth: createBearerTokenAuth(options.token),
    adminModeStore,
    createCore,
  });

  const enterAdminMode = async (adminToken: string, opts?: { ttlSeconds?: number }) => {
    const token = adminToken.trim();
    if (!token) {
      throw new Error("Admin token is required");
    }

    const http = createTyrumHttpClient({
      baseUrl: options.httpBaseUrl,
      auth: { type: "bearer", token },
    });

    const issued = await http.deviceTokens.issue({
      device_id: identity.deviceId,
      role: "client",
      scopes: [
        "operator.read",
        "operator.write",
        "operator.approvals",
        "operator.pairing",
        "operator.admin",
      ],
      ttl_seconds: opts?.ttlSeconds ?? 60 * 10,
    });

    adminModeStore.enter({
      elevatedToken: issued.token,
      expiresAt: issued.expires_at,
    });
  };

  const exitAdminMode = (): void => {
    adminModeStore.exit();
  };

  const dispose = (): void => {
    manager.dispose();
    adminModeStore.dispose();
  };

  return { manager, enterAdminMode, exitAdminMode, dispose };
}
