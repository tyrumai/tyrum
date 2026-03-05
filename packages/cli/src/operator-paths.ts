import { homedir } from "node:os";
import { join } from "node:path";

export function resolveTyrumHome(): string {
  const fromEnv = process.env["TYRUM_HOME"]?.trim();
  if (fromEnv && fromEnv.length > 0) return fromEnv;
  return join(homedir(), ".tyrum");
}

function resolveOperatorDir(home = resolveTyrumHome()): string {
  return join(home, "operator");
}

export function resolveOperatorConfigPath(home = resolveTyrumHome()): string {
  return join(resolveOperatorDir(home), "config.json");
}

export function resolveOperatorDeviceIdentityPath(home = resolveTyrumHome()): string {
  return join(resolveOperatorDir(home), "device-identity.json");
}

export function resolveOperatorElevatedModePath(home = resolveTyrumHome()): string {
  return join(resolveOperatorDir(home), "elevated-mode.json");
}

export function resolveGatewayWsUrl(gatewayUrl: string): string {
  let parsed: URL;
  try {
    parsed = new URL(gatewayUrl);
  } catch {
    throw new Error("config.gateway_url must be a valid absolute URL");
  }

  const wsUrl = new URL("/ws", parsed);
  if (wsUrl.protocol === "http:") wsUrl.protocol = "ws:";
  else if (wsUrl.protocol === "https:") wsUrl.protocol = "wss:";
  else if (wsUrl.protocol === "ws:" || wsUrl.protocol === "wss:") {
    // ok
  } else {
    throw new Error("config.gateway_url must use http(s)://");
  }

  return wsUrl.toString();
}
