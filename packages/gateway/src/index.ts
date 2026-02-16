/**
 * Gateway entry point.
 *
 * Creates the DI container, builds the Hono app, and starts the HTTP server.
 */

import { serve } from "@hono/node-server";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createContainer } from "./container.js";
import { createApp } from "./app.js";

export const VERSION = "0.1.0";

// Re-export for library consumers
export { createContainer } from "./container.js";
export type { GatewayConfig, GatewayContainer } from "./container.js";
export { createApp } from "./app.js";
export { createEventBus } from "./event-bus.js";
export type { GatewayEvents, EventBus } from "./event-bus.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

function main(): void {
  const port = parseInt(process.env["GATEWAY_PORT"] ?? "8080", 10);
  const dbPath = process.env["GATEWAY_DB_PATH"] ?? "gateway.db";
  const migrationsDir =
    process.env["GATEWAY_MIGRATIONS_DIR"] ?? join(__dirname, "../migrations");
  const modelGatewayConfigPath =
    process.env["MODEL_GATEWAY_CONFIG"] ?? undefined;

  const container = createContainer({
    dbPath,
    migrationsDir,
    modelGatewayConfigPath,
  });

  const app = createApp(container);

  console.log(`Gateway v${VERSION} listening on port ${port}`);
  serve({ fetch: app.fetch, port });
}

// Run when executed directly
const isMain =
  process.argv[1] &&
  (process.argv[1].endsWith("/index.js") ||
    process.argv[1].endsWith("/index.ts"));

if (isMain) {
  main();
}
