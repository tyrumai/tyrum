import { createServer as createHttpServer } from "node:http";
import { createServer as createHttpsServer } from "node:https";
import { getRequestListener } from "@hono/node-server";
import { ensureSelfSignedTlsMaterial } from "../modules/tls/self-signed.js";
import { createWsHandler } from "../routes/ws.js";
import type { createApp } from "../app.js";
import type { GatewayBootContext, GatewayServer } from "./runtime-shared.js";

export async function createGatewayServer(
  context: GatewayBootContext,
  app: ReturnType<typeof createApp> | undefined,
  wsHandler: ReturnType<typeof createWsHandler> | undefined,
): Promise<{ server: GatewayServer; tlsFingerprint256?: string } | undefined> {
  if (!context.shouldRunEdge || !app || !wsHandler) {
    return undefined;
  }

  const listener = getRequestListener(app.fetch);
  const tlsSelfSigned = context.deploymentConfig.server.tlsSelfSigned ?? false;
  const { server, tlsMaterial } = await (async () => {
    if (!tlsSelfSigned) {
      return { server: createHttpServer(listener), tlsMaterial: null };
    }
    const material = await ensureSelfSignedTlsMaterial({ home: context.tyrumHome });
    return {
      server: createHttpsServer({ key: material.keyPem, cert: material.certPem }, listener),
      tlsMaterial: material,
    };
  })();

  server.on("upgrade", (req, socket, head) => {
    const pathname = new URL(req.url ?? "/", "http://localhost").pathname;
    if (pathname === "/ws") {
      wsHandler.handleUpgrade(req, socket, head);
    } else {
      socket.destroy();
    }
  });

  server.listen(context.port, context.host, () => {
    const scheme = tlsSelfSigned ? "https" : "http";
    context.logger.info("gateway.listen", {
      host: context.host,
      port: context.port,
      url: `${scheme}://${context.host}:${context.port}`,
      tls_self_signed: tlsSelfSigned,
      tls_fingerprint256: tlsMaterial?.fingerprint256 ?? null,
    });

    if (tlsSelfSigned && tlsMaterial) {
      console.log("---");
      console.log("TLS enabled (self-signed). Browsers will show a warning unless trusted.");
      console.log(`TLS fingerprint (SHA-256): ${tlsMaterial.fingerprint256}`);
      console.log(`TLS certificate: ${tlsMaterial.certPath}`);
      console.log(`TLS key: ${tlsMaterial.keyPath}`);
      console.log(`UI: https://${context.host}:${context.port}/ui`);
      console.log(`WS: wss://${context.host}:${context.port}/ws`);
      console.log("Verify the fingerprint out-of-band (e.g. SSH) before trusting.");
      console.log("---");
    }
  });

  return { server, tlsFingerprint256: tlsMaterial?.fingerprint256 };
}
