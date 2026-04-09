import { TyrumClient, createTyrumHttpClient } from "@tyrum/operator-app/node";
import { resolveGatewayWsUrl } from "../operator-paths.js";
import { requireOperatorConfig, requireOperatorDeviceIdentity } from "../operator-state.js";

export type BenchmarkHttpClient = ReturnType<typeof createTyrumHttpClient>;

async function connectWsClient(client: TyrumClient): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error("WebSocket connect timed out"));
    }, 10_000);

    const cleanup = (): void => {
      clearTimeout(timer);
      client.off("connected", onConnected);
      client.off("transport_error", onTransportError);
      client.off("disconnected", onDisconnected);
    };

    const onConnected = (): void => {
      cleanup();
      resolve();
    };
    const onTransportError = (event: { message: string }): void => {
      cleanup();
      reject(new Error(event.message));
    };
    const onDisconnected = (event: { code: number; reason: string }): void => {
      cleanup();
      reject(new Error(`WebSocket disconnected (${String(event.code)}): ${event.reason}`));
    };

    client.on("connected", onConnected);
    client.on("transport_error", onTransportError);
    client.on("disconnected", onDisconnected);
    client.connect();
  });
}

export async function createBenchmarkOperatorSession(home: string): Promise<{
  http: BenchmarkHttpClient;
  ws: TyrumClient;
  close: () => void;
}> {
  const config = await requireOperatorConfig(home);
  const identity = await requireOperatorDeviceIdentity(home);
  const http = createTyrumHttpClient({
    baseUrl: config.gateway_url,
    auth: { type: "bearer", token: config.auth_token },
    ...(config.tls_cert_fingerprint256
      ? { tlsCertFingerprint256: config.tls_cert_fingerprint256 }
      : {}),
  });
  const ws = new TyrumClient({
    url: resolveGatewayWsUrl(config.gateway_url),
    token: config.auth_token,
    reconnect: false,
    capabilities: [],
    ...(config.tls_cert_fingerprint256
      ? { tlsCertFingerprint256: config.tls_cert_fingerprint256 }
      : {}),
    device: {
      deviceId: identity.deviceId,
      publicKey: identity.publicKey,
      privateKey: identity.privateKey,
    },
  });

  await connectWsClient(ws);
  return {
    http,
    ws,
    close: () => {
      ws.disconnect();
    },
  };
}
