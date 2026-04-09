import { createServer as createHttpServer } from "node:http";
import { getRequestListener } from "@hono/node-server";
import { DesktopTakeoverTokenDal } from "../modules/desktop-environments/takeover-token-dal.js";
import { matchesDesktopTakeoverProxyPath } from "../modules/desktop-environments/takeover-token.js";
import { createDesktopTakeoverWsProxy } from "../modules/desktop-environments/takeover-proxy.js";
import { createWsHandler } from "../routes/ws.js";
import type { createApp } from "../app.js";
import type { GatewayBootContext, GatewayServer } from "./runtime-shared.js";

export async function createGatewayServer(
  context: GatewayBootContext,
  app: ReturnType<typeof createApp> | undefined,
  wsHandler: ReturnType<typeof createWsHandler> | undefined,
): Promise<{ server: GatewayServer } | undefined> {
  if (!context.shouldRunEdge || !app || !wsHandler) {
    return undefined;
  }

  const listener = getRequestListener(app.fetch);
  const server = createHttpServer(listener);
  const desktopTakeoverWsProxy = createDesktopTakeoverWsProxy({
    conversationDal: new DesktopTakeoverTokenDal(context.container.db),
    logger: context.logger,
  });

  server.on("upgrade", (req, socket, head) => {
    const pathname = new URL(req.url ?? "/", "http://localhost").pathname;
    if (pathname === "/ws") {
      wsHandler.handleUpgrade(req, socket, head);
    } else if (matchesDesktopTakeoverProxyPath(pathname)) {
      desktopTakeoverWsProxy.handleUpgrade(req, socket, head);
    } else {
      socket.destroy();
    }
  });

  server.listen(context.port, context.host, () => {
    context.logger.info("gateway.listen", {
      host: context.host,
      port: context.port,
      url: `http://${context.host}:${context.port}`,
    });
  });

  return { server };
}
