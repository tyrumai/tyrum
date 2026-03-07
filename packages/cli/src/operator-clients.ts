import { TyrumClient, TyrumHttpClientError, createTyrumHttpClient } from "@tyrum/client/node";

import { resolveGatewayWsUrl } from "./operator-paths.js";
import { requireOperatorConfig, requireOperatorDeviceIdentity } from "./operator-state.js";

async function withWsClient<T>(
  opts: ConstructorParameters<typeof TyrumClient>[0],
  fn: (client: TyrumClient) => Promise<T>,
): Promise<T> {
  const client = new TyrumClient(opts);

  try {
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
      const onTransportError = (evt: { message: string }): void => {
        cleanup();
        reject(new Error(evt.message));
      };
      const onDisconnected = (evt: { code: number; reason: string }): void => {
        cleanup();
        reject(new Error(`WebSocket disconnected (${String(evt.code)}): ${evt.reason}`));
      };

      client.on("connected", onConnected);
      client.on("transport_error", onTransportError);
      client.on("disconnected", onDisconnected);
      client.connect();
    });
    return await fn(client);
  } finally {
    client.disconnect();
  }
}

export async function runOperatorWsCommand<T>(
  home: string,
  label: string,
  fn: (client: TyrumClient) => Promise<T>,
): Promise<number> {
  try {
    const config = await requireOperatorConfig(home);
    const identity = await requireOperatorDeviceIdentity(home);
    const wsUrl = resolveGatewayWsUrl(config.gateway_url);
    const result = await withWsClient(
      {
        url: wsUrl,
        token: config.auth_token,
        reconnect: false,
        capabilities: ["cli"],
        ...(config.tls_cert_fingerprint256
          ? { tlsCertFingerprint256: config.tls_cert_fingerprint256 }
          : {}),
        ...(config.tls_allow_self_signed ? { tlsAllowSelfSigned: true } : {}),
        device: {
          deviceId: identity.deviceId,
          publicKey: identity.publicKey,
          privateKey: identity.privateKey,
        },
      },
      fn,
    );
    console.log(JSON.stringify(result, null, 2));
    return 0;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`${label}: failed: ${message}`);
    return 1;
  }
}

type TyrumHttpClient = ReturnType<typeof createTyrumHttpClient>;

export async function runOperatorHttpCommand<T>(
  home: string,
  label: string,
  fn: (http: TyrumHttpClient) => Promise<T>,
  opts?: { token?: string },
): Promise<number> {
  try {
    const config = await requireOperatorConfig(home);
    const token = (opts?.token ?? config.auth_token).trim();
    const http = createTyrumHttpClient({
      baseUrl: config.gateway_url,
      auth: { type: "bearer", token },
      ...(config.tls_cert_fingerprint256
        ? { tlsCertFingerprint256: config.tls_cert_fingerprint256 }
        : {}),
      ...(config.tls_allow_self_signed ? { tlsAllowSelfSigned: true } : {}),
    });
    const result = await fn(http);
    console.log(JSON.stringify(result, null, 2));
    return 0;
  } catch (error) {
    if (error instanceof TyrumHttpClientError) {
      const status = error.status ? `status=${String(error.status)}` : "status=unknown";
      console.error(`${label}: failed: ${status} message=${error.message}`);
      return 1;
    }
    const message = error instanceof Error ? error.message : String(error);
    console.error(`${label}: failed: ${message}`);
    return 1;
  }
}
