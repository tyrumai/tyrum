import {
  createBearerTokenAuth,
  createElevatedModeStore,
  createNodeFileDeviceIdentityStorage,
  createOperatorCore,
  createOperatorCoreManager,
  createTyrumHttpClient,
  httpAuthForAuth,
  isElevatedModeActive,
  loadOrCreateDeviceIdentity,
  TyrumClient,
  wsTokenForAuth,
  type OperatorCore,
  type OperatorCoreFactory,
  type OperatorCoreManager,
  type OperatorWsClient,
} from "@tyrum/operator-app/node";

export type TuiCoreOptions = {
  wsUrl: string;
  httpBaseUrl: string;
  token: string;
  deviceIdentityPath: string;
  tlsCertFingerprint256?: string;
  tlsAllowSelfSigned?: boolean;
  reconnect?: boolean;
};

export type TuiRuntime = {
  manager: OperatorCoreManager;
  enterElevatedMode(accessToken: string, opts?: { ttlSeconds?: number }): Promise<void>;
  exitElevatedMode(): void;
  dispose(): void;
};

export async function createTuiCore(options: TuiCoreOptions): Promise<TuiRuntime> {
  const identity = await loadOrCreateDeviceIdentity(
    createNodeFileDeviceIdentityStorage(options.deviceIdentityPath),
  );

  const elevatedModeStore = createElevatedModeStore();

  const createCore: OperatorCoreFactory = (coreOptions): OperatorCore => {
    const ws = new TyrumClient({
      url: coreOptions.wsUrl,
      token: wsTokenForAuth(coreOptions.auth),
      tlsCertFingerprint256: options.tlsCertFingerprint256,
      tlsAllowSelfSigned: options.tlsAllowSelfSigned,
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

    const http = createTyrumHttpClient({
      baseUrl: coreOptions.httpBaseUrl,
      auth: httpAuthForAuth(coreOptions.auth),
      tlsCertFingerprint256: options.tlsCertFingerprint256,
      tlsAllowSelfSigned: options.tlsAllowSelfSigned,
    });

    return createOperatorCore({
      wsUrl: coreOptions.wsUrl,
      httpBaseUrl: coreOptions.httpBaseUrl,
      auth: coreOptions.auth,
      deviceIdentity: identity,
      elevatedModeStore: coreOptions.elevatedModeStore,
      deps: {
        // Operator core expects the full WS client surface, so the concrete client is widened here.
        ws: ws as unknown as OperatorWsClient,
        http,
        createPrivilegedWs() {
          const elevatedMode = coreOptions.elevatedModeStore.getSnapshot();
          const token = elevatedMode.elevatedToken?.trim();
          if (!isElevatedModeActive(elevatedMode) || !token) {
            return null;
          }

          return new TyrumClient({
            url: coreOptions.wsUrl,
            token,
            tlsCertFingerprint256: options.tlsCertFingerprint256,
            tlsAllowSelfSigned: options.tlsAllowSelfSigned,
            reconnect: false,
            capabilities: [],
            device: {
              publicKey: identity.publicKey,
              privateKey: identity.privateKey,
              deviceId: identity.deviceId,
              label: "tui",
              platform: typeof process !== "undefined" ? process.platform : "unknown",
              version: typeof process !== "undefined" ? process.version : "unknown",
            },
          }) as unknown as OperatorWsClient;
        },
        createPrivilegedHttp() {
          const elevatedMode = coreOptions.elevatedModeStore.getSnapshot();
          const token = elevatedMode.elevatedToken?.trim();
          if (!isElevatedModeActive(elevatedMode) || !token) {
            return null;
          }

          return createTyrumHttpClient({
            baseUrl: coreOptions.httpBaseUrl,
            auth: { type: "bearer", token },
            tlsCertFingerprint256: options.tlsCertFingerprint256,
            tlsAllowSelfSigned: options.tlsAllowSelfSigned,
          });
        },
      },
    });
  };

  const manager = createOperatorCoreManager({
    wsUrl: options.wsUrl,
    httpBaseUrl: options.httpBaseUrl,
    baselineAuth: createBearerTokenAuth(options.token),
    elevatedModeStore,
    createCore,
  });

  const enterElevatedMode = async (accessToken: string, opts?: { ttlSeconds?: number }) => {
    const token = accessToken.trim();
    if (!token) {
      throw new Error("Elevated access token is required");
    }

    const http = createTyrumHttpClient({
      baseUrl: options.httpBaseUrl,
      auth: { type: "bearer", token },
      tlsCertFingerprint256: options.tlsCertFingerprint256,
      tlsAllowSelfSigned: options.tlsAllowSelfSigned,
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

    elevatedModeStore.enter({
      elevatedToken: issued.token,
      expiresAt: issued.expires_at,
    });
  };

  const exitElevatedMode = (): void => {
    elevatedModeStore.exit();
  };

  const dispose = (): void => {
    manager.dispose();
    elevatedModeStore.dispose();
  };

  return { manager, enterElevatedMode, exitElevatedMode, dispose };
}
