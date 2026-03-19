import { afterEach, describe, expect, it } from "vitest";
import { startSmokeGateway } from "./smoke-turn-harness.js";
import { TyrumClient } from "@tyrum/client";
import { simulateReadableStream } from "ai";
import { MockLanguageModelV3 } from "ai/test";
import {
  WsAiSdkChatStreamEvent,
  WsChatSessionCreateResult,
  WsChatSessionGetResult,
  WsChatSessionStreamStart,
} from "@tyrum/contracts";

describe("gateway e2e smoke: login-to-turn", () => {
  let stopGateway: (() => Promise<void>) | undefined;
  let client: TyrumClient | undefined;

  afterEach(async () => {
    client?.disconnect();
    client = undefined;
    await stopGateway?.();
    stopGateway = undefined;
  });

  async function connectClient(input: {
    adminToken: string;
    baseUrl: string;
    wsUrl: string;
  }): Promise<TyrumClient> {
    const healthRes = await fetch(`${input.baseUrl}/healthz`);
    expect(healthRes.status).toBe(200);

    const authRes = await fetch(`${input.baseUrl}/auth/session`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token: input.adminToken }),
    });
    expect(authRes.status).toBe(204);

    const setCookie =
      authRes.headers.get("set-cookie") ??
      ("getSetCookie" in authRes.headers && typeof authRes.headers.getSetCookie === "function"
        ? authRes.headers.getSetCookie()[0]
        : null);
    expect(setCookie ?? "").toContain("tyrum_admin_token=");

    const nextClient = new TyrumClient({
      url: input.wsUrl,
      token: input.adminToken,
      capabilities: [],
      reconnect: false,
      role: "client",
      protocolRev: 2,
    });

    const connectedP = new Promise<void>((resolve) => {
      nextClient.on("connected", () => resolve());
    });
    nextClient.connect();
    await connectedP;
    return nextClient;
  }

  async function waitFor<T>(fn: () => Promise<T | undefined>, timeoutMs = 10_000): Promise<T> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const result = await fn();
      if (result !== undefined) {
        return result;
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    throw new Error("timed out waiting for condition");
  }

  function createApprovalLanguageModel(): MockLanguageModelV3 {
    let callCount = 0;
    const usage = {
      inputTokens: { total: 10, noCache: 10, cacheRead: undefined, cacheWrite: undefined },
      outputTokens: { total: 5, text: 5, reasoning: undefined },
    };

    return new MockLanguageModelV3({
      doStream: async () => {
        callCount += 1;
        if (callCount === 1) {
          return {
            stream: simulateReadableStream({
              chunks: [
                {
                  type: "tool-call" as const,
                  toolCallId: "tc-bash-1",
                  toolName: "bash",
                  input: JSON.stringify({ command: "printf smoke-approval" }),
                },
                {
                  type: "finish" as const,
                  finishReason: { unified: "tool-calls" as const, raw: undefined },
                  logprobs: undefined,
                  usage,
                },
              ],
            }),
            warnings: [],
          };
        }

        return {
          stream: simulateReadableStream({
            chunks: [
              { type: "text-start" as const, id: "text-1" },
              { type: "text-delta" as const, id: "text-1", delta: "approval-complete" },
              { type: "text-end" as const, id: "text-1" },
              {
                type: "finish" as const,
                finishReason: { unified: "stop" as const, raw: undefined },
                logprobs: undefined,
                usage,
              },
            ],
          }),
          warnings: [],
        };
      },
    });
  }

  it("starts gateway, authenticates via /auth/session, connects WS, sends chat.session.send, receives reply", async () => {
    const gateway = await startSmokeGateway({ modelReply: "smoke-ok" });
    stopGateway = gateway.stop;
    client = await connectClient(gateway);

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

  it("persists the submitted message immediately and completes after approval resolves", async () => {
    const gateway = await startSmokeGateway({
      agentConfigText: [
        "model:",
        "  model: openai/gpt-4.1",
        "skills:",
        "  enabled: []",
        "mcp:",
        "  enabled: []",
        "tools:",
        "  default_mode: allow",
        "sessions:",
        "  ttl_days: 30",
        "  max_turns: 20",
        "memory:",
        "  v1: { enabled: false }",
      ].join("\n"),
      languageModel: createApprovalLanguageModel(),
    });
    stopGateway = gateway.stop;
    client = await connectClient(gateway);

    const created = await client.requestDynamic(
      "chat.session.create",
      { channel: "ui" },
      WsChatSessionCreateResult,
    );
    await client.requestDynamic(
      "chat.session.send",
      {
        session_id: created.session.session_id,
        messages: [
          {
            id: "msg-approval-1",
            role: "user",
            parts: [{ type: "text", text: "Run a safe shell command" }],
          },
        ],
        trigger: "submit-message",
      },
      WsChatSessionStreamStart,
    );

    const initialSession = await client.requestDynamic(
      "chat.session.get",
      { session_id: created.session.session_id },
      WsChatSessionGetResult,
    );
    expect(initialSession.session.messages.at(-1)?.role).toBe("user");
    expect(initialSession.session.messages.at(-1)?.parts[0]).toMatchObject({
      type: "text",
      text: "Run a safe shell command",
    });

    const pendingApproval = await waitFor(async () => {
      const listed = await client!.approvalList({ limit: 20 });
      return listed.approvals.find(
        (approval) =>
          approval.prompt === "Approve execution of 'bash'" &&
          (approval.status === "queued" ||
            approval.status === "reviewing" ||
            approval.status === "awaiting_human"),
      );
    });

    const blockedSession = await client.requestDynamic(
      "chat.session.get",
      { session_id: created.session.session_id },
      WsChatSessionGetResult,
    );
    const blockedAssistant = blockedSession.session.messages.findLast(
      (message) => message.role === "assistant",
    );
    const blockedTextPart = blockedAssistant?.parts.find((part) => part.type === "text");
    expect(blockedSession.session.messages.some((message) => message.role === "user")).toBe(true);
    expect(blockedTextPart?.text).not.toBe("approval-complete");

    await client.approvalResolve({
      approval_id: pendingApproval.approval_id,
      decision: "approved",
    });

    const finalSession = await waitFor(async () => {
      const session = await client!.requestDynamic(
        "chat.session.get",
        { session_id: created.session.session_id },
        WsChatSessionGetResult,
      );
      const assistantMessage = session.session.messages.findLast(
        (message) => message.role === "assistant",
      );
      const textPart = assistantMessage?.parts.find((part) => part.type === "text");
      return textPart?.text === "approval-complete" ? session : undefined;
    }, 15_000);

    const assistantMessage = finalSession.session.messages.findLast(
      (message) => message.role === "assistant",
    );
    expect(assistantMessage?.parts.find((part) => part.type === "text")).toMatchObject({
      type: "text",
      text: "approval-complete",
    });
  }, 30_000);
});
