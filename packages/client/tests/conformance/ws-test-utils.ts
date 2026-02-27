import { TyrumClient } from "../../src/ws-client.js";
import { generateDeviceKeys, type GatewayHarness } from "./harness.js";

export const CONFORMANCE_TIMEOUT_MS = 5_000;

export function waitForEvent<T>(client: TyrumClient, event: string): Promise<T> {
  return waitForEventMatching<T>(client, event, () => true);
}

export function waitForEventMatching<T>(
  client: TyrumClient,
  event: string,
  match: (data: T) => boolean,
): Promise<T> {
  return new Promise<T>((resolve) => {
    const handler = (data: T) => {
      if (!match(data)) return;
      client.off(event as never, handler as never);
      resolve(data);
    };
    client.on(event as never, handler as never);
  });
}

export function createConnectedClient(
  gw: GatewayHarness,
  opts?: { capabilities?: string[]; role?: string; protocolRev?: number },
): { client: TyrumClient; connectedP: Promise<{ clientId: string }> } {
  const device = generateDeviceKeys();
  const client = new TyrumClient({
    url: gw.wsUrl,
    token: gw.adminToken,
    capabilities: (opts?.capabilities ?? ["http"]) as never[],
    reconnect: false,
    role: (opts?.role ?? "client") as never,
    protocolRev: opts?.protocolRev ?? 2,
    device,
  });

  const connectedP = waitForEvent<{ clientId: string }>(client, "connected");
  client.connect();
  return { client, connectedP };
}
