#!/usr/bin/env node
import { createServer } from "node:http";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import process from "node:process";
import next from "next";
import { getRequestListener } from "@hono/node-server";
import { createApp, createContainer, TokenStore } from "@tyrum/gateway";

function parsePort(value, fallback) {
  const parsed = Number.parseInt(value ?? "", 10);
  if (Number.isFinite(parsed) && parsed > 0) {
    return parsed;
  }
  return fallback;
}

function isGatewayPath(pathname) {
  return (
    pathname === "/healthz" ||
    pathname === "/plan" ||
    pathname.startsWith("/agent/") ||
    pathname.startsWith("/policy/") ||
    pathname.startsWith("/memory/") ||
    pathname.startsWith("/ingress/") ||
    pathname.startsWith("/v1/")
  );
}

const host = (process.env.HOST ?? process.env.SINGLE_HOST ?? "127.0.0.1").trim();
const port = parsePort(process.env.PORT, 3000);
const repoRoot = resolve(process.cwd(), "..");
const dbPath = process.env.GATEWAY_DB_PATH ?? resolve(repoRoot, "gateway.db");
const migrationsDir =
  process.env.GATEWAY_MIGRATIONS_DIR ??
  resolve(repoRoot, "packages/gateway/migrations");
const modelGatewayConfigPath = process.env.MODEL_GATEWAY_CONFIG ?? undefined;
const tyrumHome = process.env.TYRUM_HOME ?? join(homedir(), ".tyrum");

const localHosts = new Set(["127.0.0.1", "localhost", "::1"]);
const isLocalOnly = localHosts.has(host);
if (!isLocalOnly) {
  const tokenPath = join(tyrumHome, ".admin-token");
  console.warn(
    "Single-instance runtime is binding to a non-local interface; gateway auth is required.",
  );
  console.warn(`Admin token path: ${tokenPath}`);
}

const dev = process.env.NODE_ENV !== "production";
const nextApp = next({
  dev,
  dir: process.cwd(),
  hostname: host,
  port,
});

await nextApp.prepare();
const nextHandler = nextApp.getRequestHandler();
const nextUpgradeHandler = nextApp.getUpgradeHandler();

const container = createContainer({
  dbPath,
  migrationsDir,
  modelGatewayConfigPath,
});
const tokenStore = new TokenStore(tyrumHome);
await tokenStore.initialize();
const gatewayApp = createApp(container, { tokenStore, isLocalOnly });
const gatewayListener = getRequestListener(gatewayApp.fetch);

const server = createServer((req, res) => {
  const url = new URL(req.url ?? "/", "http://localhost");
  if (isGatewayPath(url.pathname)) {
    gatewayListener(req, res);
    return;
  }

  nextHandler(req, res);
});

server.on("upgrade", (req, socket, head) => {
  const url = new URL(req.url ?? "/", "http://localhost");
  if (url.pathname === "/ws") {
    socket.write(
      "HTTP/1.1 501 Not Implemented\r\n" +
        "Connection: close\r\n" +
        "Content-Type: text/plain\r\n\r\n" +
        "WebSocket upgrades are not wired in single-instance mode.\r\n",
    );
    socket.destroy();
    return;
  }

  void nextUpgradeHandler(req, socket, head).catch((error) => {
    console.error("Failed to handle WebSocket upgrade:", error);
    socket.destroy();
  });
});

server.listen(port, host, () => {
  console.log(`Single-instance runtime listening on http://${host}:${port}`);
  console.log(`Gateway DB: ${dbPath}`);
});
