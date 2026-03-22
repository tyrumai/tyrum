/**
 * Gateway entry point.
 *
 * Re-exports the public library surface and dispatches the CLI when run directly.
 */

import { basename } from "node:path";
import { parseCliArgs, runCli } from "./bootstrap/cli.js";
import { formatFatalErrorForConsole } from "./bootstrap/errors.js";

export { VERSION } from "./version.js";
export { createContainer, createContainerAsync } from "./container.js";
export type { GatewayContainer, GatewayContainerConfig } from "./container.js";
export { createApp } from "./app.js";
export { createEventBus } from "./event-bus.js";
export type { GatewayEvents, EventBus } from "./event-bus.js";
export { createWsHandler } from "./routes/ws.js";
export type { WsRouteOptions } from "./routes/ws.js";
export { ConnectionManager } from "./ws/connection-manager.js";
export type { ConnectedClient, ConnectionStats } from "./ws/connection-manager.js";
export { formatFatalErrorForConsole } from "./bootstrap/errors.js";
export { main, runShutdownCleanup } from "./bootstrap/runtime.js";
export {
  applyStartCommandDeploymentOverrides,
  assertSplitRoleUsesPostgres,
  buildStartupDefaultDeploymentConfig,
  ensureDatabaseDirectory,
  resolveGatewayLogLevel,
  resolveGatewayLogStackTraces,
  resolveSnapshotImportEnabled,
} from "./bootstrap/config.js";
export { parseCliArgs, resolveGatewayUpdateTarget, runCli } from "./bootstrap/cli.js";
export { assertNonLoopbackDeploymentGuardrails, splitHostAndPort } from "./bootstrap/network.js";
export type { NonLoopbackTransportPolicy } from "./bootstrap/network.js";

const isMain = (() => {
  const entry = process.argv[1];
  if (!entry) return false;

  const filename = basename(entry);
  return filename === "index.mjs" || filename === "index.js" || filename === "index.ts";
})();

function shouldForceExitAfterCli(argv: readonly string[]): boolean {
  try {
    return parseCliArgs(argv).kind !== "start";
  } catch {
    return true;
  }
}

if (isMain) {
  const argv = process.argv.slice(2);
  const shouldForceExit = shouldForceExitAfterCli(argv);
  void runCli(argv)
    .then((code) => {
      if (code !== 0 || shouldForceExit) {
        process.exit(code);
      }
    })
    .catch((error) => {
      console.error(`error: ${formatFatalErrorForConsole(error)}`);
      process.exit(1);
    });
}
