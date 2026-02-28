import { afterEach, describe, expect, it } from "vitest";
import { startSmokeGateway } from "./smoke-turn-harness.js";
import { TyrumClient } from "@tyrum/client";

describe("gateway e2e smoke: login-to-turn", () => {
  let stopGateway: (() => Promise<void>) | undefined;
  let client: TyrumClient | undefined;

  afterEach(async () => {
    client?.disconnect();
    client = undefined;
    await stopGateway?.();
    stopGateway = undefined;
  });

  it("starts gateway, authenticates via /auth/session, connects WS, sends session.send, receives reply", async () => {
    const gateway = await startSmokeGateway({ modelReply: "smoke-ok" });
    stopGateway = gateway.stop;

    const healthRes = await fetch(`${gateway.baseUrl}/healthz`);
    expect(healthRes.status).toBe(200);

    const authRes = await fetch(`${gateway.baseUrl}/auth/session`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token: gateway.adminToken }),
    });
    expect(authRes.status).toBe(204);

    const setCookie =
      authRes.headers.get("set-cookie") ??
      ("getSetCookie" in authRes.headers && typeof authRes.headers.getSetCookie === "function"
        ? authRes.headers.getSetCookie()[0]
        : null);
    expect(setCookie ?? "").toContain("tyrum_admin_token=");

    client = new TyrumClient({
      url: gateway.wsUrl,
      token: gateway.adminToken,
      capabilities: [],
      reconnect: false,
      role: "client",
      protocolRev: 2,
    });

    const connectedP = new Promise<void>((resolve) => {
      client!.on("connected", () => resolve());
    });
    client.connect();
    await connectedP;

    const result = await client.sessionSend({
      channel: "ui",
      thread_id: "thread-1",
      content: "hello",
    });
    expect(result.assistant_message).toBe("smoke-ok");

    client.disconnect();
    client = undefined;
  }, 30_000);
});
