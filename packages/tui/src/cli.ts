import React from "react";
import { homedir } from "node:os";
import { join } from "node:path";
import { render } from "ink";
import { parseTuiCliArgs } from "./cli-args.js";
import { resolveTuiConfig } from "./config.js";
import { createTuiCore } from "./core.js";
import { TuiApp } from "./app.js";
import { VERSION } from "./version.js";

function printCliHelp(): void {
  console.log("tyrum-tui — Tyrum terminal UI (Ink)");
  console.log("");
  console.log("Usage:");
  console.log("  tyrum-tui [start] [options]");
  console.log("  tyrum-tui --help");
  console.log("  tyrum-tui --version");
  console.log("");
  console.log("Options:");
  console.log(
    "  --gateway <url>            Gateway base URL (http(s)://...) or WS URL (ws(s)://...)",
  );
  console.log("  --token <token>            Gateway token (or env GATEWAY_TOKEN)");
  console.log("  --home, --tyrum-home <dir> Override TYRUM_HOME (default: ~/.tyrum)");
  console.log(
    "  --device-identity <path>   Device identity JSON path (default: $TYRUM_HOME/tui/device-identity.json)",
  );
  console.log("  --tls-fingerprint256 <hex> TLS certificate SHA-256 pin for wss:// connections");
  console.log("  --reconnect                Enable auto-reconnect (default)");
  console.log("  --no-reconnect             Disable auto-reconnect");
  console.log("");
  console.log("Env:");
  console.log("  GATEWAY_TOKEN, TYRUM_HOME");
}

export async function runCli(argv: readonly string[] = process.argv.slice(2)): Promise<number> {
  let command: ReturnType<typeof parseTuiCliArgs>;
  try {
    command = parseTuiCliArgs(argv);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`error: ${message}`);
    printCliHelp();
    return 1;
  }

  if (command.kind === "help") {
    printCliHelp();
    return 0;
  }

  if (command.kind === "version") {
    console.log(VERSION);
    return 0;
  }

  const config = resolveTuiConfig({
    env: process.env,
    defaults: {
      gatewayUrl: "http://127.0.0.1:8788",
      tyrumHome: join(homedir(), ".tyrum"),
    },
    gatewayUrl: command.gatewayUrl,
    token: command.token,
    tyrumHome: command.tyrumHome,
    deviceIdentityPath: command.deviceIdentityPath,
    tlsCertFingerprint256: command.tlsCertFingerprint256,
    reconnect: command.reconnect,
  });

  let core: Awaited<ReturnType<typeof createTuiCore>> | null = null;
  let instance: ReturnType<typeof render> | null = null;

  try {
    core = await createTuiCore(config);
    instance = render(React.createElement(TuiApp, { core, config }));
    const result = await instance.waitUntilExit();
    return typeof result === "number" ? result : 0;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`error: ${message}`);
    return 1;
  } finally {
    try {
      instance?.cleanup();
    } catch {
      // ignore
    }
    try {
      core?.dispose();
    } catch {
      // ignore
    }
  }
}
