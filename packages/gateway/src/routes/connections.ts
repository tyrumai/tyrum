/**
 * Connections route — exposes WebSocket connection stats.
 */

import { Hono } from "hono";
import type { ConnectionManager } from "../ws/connection-manager.js";

export function createConnectionsRoute(connectionManager: ConnectionManager): Hono {
  const app = new Hono();
  app.get("/connections", (c) => c.json(connectionManager.getStats()));
  return app;
}
