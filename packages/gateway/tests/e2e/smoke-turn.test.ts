import { afterEach, describe, expect, it } from "vitest";
import { startSmokeGateway } from "./smoke-turn-harness.js";
import { TyrumClient } from "@tyrum/client";
import {
  WsAiSdkChatStreamEvent,
  WsChatSessionCreateResult,
  WsChatSessionGetResult,
  WsChatSessionStreamStart,
} from "@tyrum/schemas";

describe("gateway e2e smoke: login-to-turn", () => {
  let stopGateway: (() => Promise<void>) | undefined;
  let client: TyrumClient | undefined;

  afterEach(async () => {
    client?.disconnect();
    client = undefined;
    await stopGateway?.();
    stopGateway = undefined;
  });

  it("starts gateway, authenticates via /auth/session, connects WS, sends chat.session.send, receives reply", async () => {
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

    const created = await client.requestDynamic(
      "chat.session.create",
      { channel: "ui" },
      WsChatSessionCreateResult,
    );
    const streamDone = new Promise<void>((resolve, reject) => {
      const handleEvent = (event: unknown) => {
        const parsed = WsAiSdkChatStreamEvent.safeParse(event);
        if (!parsed.success) {
          return;
        }
        if (parsed.data.payload.stage === "chunk") {
          return;
        }
        client?.offDynamicEvent("chat.ui-message.stream", handleEvent);
        if (parsed.data.payload.stage === "done") {
          resolve();
          return;
        }
        reject(new Error(parsed.data.payload.error.message));
      };
      client?.onDynamicEvent("chat.ui-message.stream", handleEvent);
    });
    await client.requestDynamic(
      "chat.session.send",
      {
        session_id: created.session.session_id,
        messages: [
          {
            id: "msg-1",
            role: "user",
            parts: [{ type: "text", text: "hello" }],
          },
        ],
        trigger: "submit-message",
      },
      WsChatSessionStreamStart,
    );
    await streamDone;

    const session = await client.requestDynamic(
      "chat.session.get",
      { session_id: created.session.session_id },
      WsChatSessionGetResult,
    );
    const assistantMessage = session.session.messages.findLast(
      (message) => message.role === "assistant",
    );
    const textPart = assistantMessage?.parts.find((part) => part.type === "text");
    const assistantText = textPart?.text;
    expect(assistantText).toBe("smoke-ok");

    client.disconnect();
    client = undefined;
  }, 30_000);
});
