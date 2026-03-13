import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

import {
  TyrumClient,
  autoExecute,
  createNodeFileDeviceIdentityStorage,
  formatDeviceIdentityError,
  loadOrCreateDeviceIdentity,
  normalizeFingerprint256,
} from "@tyrum/client/node";
import { capabilityDescriptorsForClientCapability } from "@tyrum/schemas";

import { DesktopProvider } from "../providers/desktop-provider.js";
import { NutJsDesktopBackend } from "../providers/backends/nutjs-desktop-backend.js";
import { AtSpiDesktopA11yBackend } from "../providers/backends/atspi-a11y-backend.js";
import { getTesseractOcrEngine } from "../providers/ocr/tesseract-engine.js";
import { parseDesktopNodeArgs } from "./args.js";

export const VERSION = "0.1.0";

function resolveTyrumHome(override?: string): string {
  const raw = override ?? process.env["TYRUM_HOME"];
  const trimmed = raw?.trim();
  if (trimmed) return trimmed;
  return join(homedir(), ".tyrum");
}

function resolveGatewayWsUrl(override?: string): string {
  const raw = override ?? process.env["TYRUM_GATEWAY_WS_URL"];
  const trimmed = raw?.trim();
  if (trimmed) return trimmed;
  return "ws://127.0.0.1:8788/ws";
}

function resolveTlsFingerprint256(override?: string): string | undefined {
  const raw = override ?? process.env["TYRUM_GATEWAY_TLS_FINGERPRINT256"];
  const trimmed = raw?.trim();
  if (!trimmed) return undefined;
  const normalized = normalizeFingerprint256(trimmed);
  if (!normalized) {
    throw new Error("invalid --tls-fingerprint256 (expected a SHA-256 hex fingerprint)");
  }
  return normalized;
}

function resolveTlsAllowSelfSigned(override?: boolean): boolean {
  if (override !== undefined) return override;
  const raw = process.env["TYRUM_GATEWAY_TLS_ALLOW_SELF_SIGNED"]?.trim().toLowerCase();
  return Boolean(raw && ["1", "true", "yes", "on"].includes(raw));
}

async function resolveGatewayToken(input: {
  tokenOverride?: string;
  tokenPathOverride?: string;
}): Promise<string> {
  const tokenRaw =
    input.tokenOverride ?? process.env["TYRUM_GATEWAY_TOKEN"] ?? process.env["GATEWAY_TOKEN"];
  const token = tokenRaw?.trim();
  if (token) return token;

  const tokenPathRaw =
    input.tokenPathOverride ??
    process.env["TYRUM_GATEWAY_TOKEN_PATH"] ??
    process.env["GATEWAY_TOKEN_PATH"];
  const tokenPath = tokenPathRaw?.trim();
  if (tokenPath) {
    const fileToken = (await readFile(tokenPath, "utf8")).trim();
    if (fileToken) return fileToken;
    throw new Error(`token file is empty: ${tokenPath}`);
  }

  throw new Error("missing gateway token (set TYRUM_GATEWAY_TOKEN or TYRUM_GATEWAY_TOKEN_PATH)");
}

function resolveNodeLabel(input: { labelOverride?: string; takeoverUrlOverride?: string }): {
  label: string;
  takeoverUrl?: string;
} {
  const takeoverUrlRaw =
    input.takeoverUrlOverride ??
    process.env["TYRUM_TAKEOVER_URL"] ??
    process.env["TYRUM_DESKTOP_SANDBOX_TAKEOVER_URL"];
  const takeoverUrl = takeoverUrlRaw?.trim() ? takeoverUrlRaw.trim() : undefined;

  const labelRaw = input.labelOverride ?? process.env["TYRUM_NODE_LABEL"];
  const baseLabel = labelRaw?.trim() ? labelRaw.trim() : "tyrum-desktop-sandbox";

  const label = takeoverUrl ? `${baseLabel} (takeover: ${takeoverUrl})` : baseLabel;
  return { label, takeoverUrl };
}

function resolveNodeMode(override?: string): string | undefined {
  const raw = override ?? process.env["TYRUM_NODE_MODE"];
  const trimmed = raw?.trim();
  return trimmed ? trimmed : undefined;
}

function printHelp(): void {
  console.log(
    [
      "tyrum-desktop-node (headless desktop node)",
      "",
      "Usage:",
      "  tyrum-desktop-node --help",
      "  tyrum-desktop-node --version",
      "  tyrum-desktop-node [--ws-url <ws://.../ws>] [--token <token> | --token-path <path>]",
      "                    [--tls-fingerprint256 <hex>] [--tls-allow-self-signed]",
      "                    [--home <dir>] [--label <label>] [--mode <mode>] [--takeover-url <url>]",
      "",
      "Environment:",
      "  TYRUM_HOME                Defaults to ~/.tyrum",
      "  TYRUM_GATEWAY_WS_URL      Defaults to ws://127.0.0.1:8788/ws",
      "  TYRUM_GATEWAY_TOKEN       Gateway admin/scoped token",
      "  TYRUM_GATEWAY_TOKEN_PATH  Path to token file (e.g. /gateway/.admin-token)",
      "  TYRUM_GATEWAY_TLS_FINGERPRINT256       Gateway TLS cert SHA-256 fingerprint (wss:// only)",
      "  TYRUM_GATEWAY_TLS_ALLOW_SELF_SIGNED    Allow self-signed TLS when fingerprint is set",
      "  TYRUM_NODE_LABEL          Optional node label (shown in pairing UI)",
      "  TYRUM_NODE_MODE           Optional node mode string (e.g. desktop-sandbox)",
      "  TYRUM_TAKEOVER_URL        Optional noVNC takeover URL to embed in label",
      "",
      "Notes:",
      "  - This node advertises the 'desktop' capability and executes tasks via @nut-tree-fork/nut-js.",
      "  - Use Docker desktop-sandbox profile (issue #786) for a full GUI + noVNC environment.",
    ].join("\n"),
  );
}

export async function runCli(argv: readonly string[] = process.argv.slice(2)): Promise<number> {
  let args: ReturnType<typeof parseDesktopNodeArgs>;
  try {
    args = parseDesktopNodeArgs(argv);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`error: ${message}`);
    printHelp();
    return 1;
  }

  if (args.help) {
    printHelp();
    return 0;
  }

  if (args.version) {
    console.log(VERSION);
    return 0;
  }

  const tyrumHome = resolveTyrumHome(args.home);
  const wsUrl = resolveGatewayWsUrl(args.wsUrl);
  const token = await resolveGatewayToken({
    tokenOverride: args.token,
    tokenPathOverride: args.tokenPath,
  });
  const tlsCertFingerprint256 = resolveTlsFingerprint256(args.tlsFingerprint256);
  const tlsAllowSelfSigned = resolveTlsAllowSelfSigned(args.tlsAllowSelfSigned);
  if (tlsAllowSelfSigned && !tlsCertFingerprint256) {
    throw new Error("--tls-allow-self-signed requires --tls-fingerprint256");
  }
  const { label, takeoverUrl } = resolveNodeLabel({
    labelOverride: args.label,
    takeoverUrlOverride: args.takeoverUrl,
  });
  const mode = resolveNodeMode(args.mode);

  const identityPath = join(tyrumHome, "desktop-node", "device-identity.json");
  let identity: Awaited<ReturnType<typeof loadOrCreateDeviceIdentity>>;
  try {
    identity = await loadOrCreateDeviceIdentity(createNodeFileDeviceIdentityStorage(identityPath));
  } catch (err) {
    console.error(`error: ${formatDeviceIdentityError(err)}`);
    return 1;
  }

  const client = new TyrumClient({
    url: wsUrl,
    token,
    tlsCertFingerprint256,
    tlsAllowSelfSigned,
    capabilities: ["desktop"],
    advertisedCapabilities: capabilityDescriptorsForClientCapability("desktop"),
    role: "node",
    device: {
      publicKey: identity.publicKey,
      privateKey: identity.privateKey,
      deviceId: identity.deviceId,
      label,
      platform: process.platform,
      version: VERSION,
      mode,
    },
  });

  client.on("connected", () => {
    const suffix = takeoverUrl ? ` takeover=${takeoverUrl}` : "";
    console.log(`desktop-node: connected device_id=${identity.deviceId}${suffix}`);
  });

  client.on("disconnected", (info: { code: number; reason: string }) => {
    console.log(`desktop-node: disconnected code=${info.code} reason=${info.reason}`);
  });

  client.on("transport_error", (msg: { message: string }) => {
    console.error(`desktop-node: transport_error: ${msg.message}`);
  });

  client.on("error", (msg: { payload: { message: string } }) => {
    console.error(`desktop-node: gateway_error: ${msg.payload.message}`);
  });

  client.on(
    "pairing.updated" as never,
    (evt: { payload?: { pairing?: { status?: unknown }; scoped_token?: unknown } }) => {
      const payload = evt.payload as
        | { pairing?: { status?: unknown }; scoped_token?: unknown }
        | undefined;
      if (payload?.pairing?.status !== "approved") return;
      const scoped = payload.scoped_token;
      if (typeof scoped === "string" && scoped.trim()) {
        console.log("desktop-node: pairing approved (scoped token issued)");
      } else {
        console.log("desktop-node: pairing approved");
      }
    },
  );

  const permissions = {
    desktopScreenshot: true,
    desktopInput: true,
    desktopInputRequiresConfirmation: false,
  };

  const backend = new NutJsDesktopBackend();
  const a11yBackend = new AtSpiDesktopA11yBackend();
  const provider = new DesktopProvider(
    backend,
    permissions,
    async () => true,
    getTesseractOcrEngine(),
    a11yBackend,
  );
  autoExecute(client, [provider]);

  const stop = new Promise<void>((resolve) => {
    process.once("SIGINT", resolve);
    process.once("SIGTERM", resolve);
  });

  client.connect();
  await stop;
  client.disconnect();
  return 0;
}
