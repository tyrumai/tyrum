import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Hono } from "hono";
import { createIngressRoutes } from "../../src/routes/ingress.js";
import { openTestSqliteDb } from "../helpers/sqlite-db.js";
import type { SqliteDb } from "../../src/statestore/sqlite.js";
import { ChannelConfigDal } from "../../src/modules/channels/channel-config-dal.js";
import { GoogleChatChannelRuntime } from "../../src/modules/channels/googlechat-runtime.js";
import { DEFAULT_TENANT_ID } from "../../src/modules/identity/scope.js";
import { verifyGoogleChatRequest } from "../../src/modules/ingress/googlechat-auth.js";

vi.mock("../../src/modules/ingress/googlechat-auth.js", () => ({
  verifyGoogleChatRequest: vi.fn(),
}));

describe("google chat ingress", () => {
  let db: SqliteDb;
  let didOpenDb = false;

  beforeEach(() => {
    didOpenDb = false;
    db = openTestSqliteDb();
    didOpenDb = true;
    vi.mocked(verifyGoogleChatRequest).mockReset();
  });

  afterEach(async () => {
    if (!didOpenDb) {
      return;
    }
    didOpenDb = false;
    await db.close();
  });

  async function seedGoogleChatAccount(input: {
    accountKey: string;
    agentKey: string;
    audience: string;
    allowedUsers?: string[];
  }): Promise<void> {
    await new ChannelConfigDal(db).create({
      tenantId: DEFAULT_TENANT_ID,
      config: {
        channel: "googlechat",
        account_key: input.accountKey,
        agent_key: input.agentKey,
        auth_method: "file_path",
        service_account_file: "/tmp/service-account.json",
        audience_type: "app-url",
        audience: input.audience,
        allowed_users: input.allowedUsers ?? [],
      },
    });
  }

  function createGoogleChatRuntime(): GoogleChatChannelRuntime {
    return new GoogleChatChannelRuntime(new ChannelConfigDal(db));
  }

  function createEvent(overrides?: Partial<Record<string, unknown>>) {
    return {
      type: "MESSAGE",
      eventTime: "2026-03-17T12:00:00.000Z",
      message: {
        name: "spaces/AAA/messages/BBB",
        text: "Hello from chat",
        argumentText: "Hello from chat",
        sender: {
          name: "users/123",
          displayName: "Alice",
          email: "alice@example.com",
          type: "HUMAN",
        },
      },
      space: {
        name: "spaces/AAA",
        type: "DM",
      },
      ...overrides,
    };
  }

  it("routes verified Google Chat messages to the matched account and agent", async () => {
    await seedGoogleChatAccount({
      accountKey: "one",
      agentKey: "default",
      audience: "https://example.test/googlechat/one",
    });
    await seedGoogleChatAccount({
      accountKey: "two",
      agentKey: "agent-b",
      audience: "https://example.test/googlechat/two",
    });

    vi.mocked(verifyGoogleChatRequest).mockImplementation(async (params) => ({
      ok: params.audience === "https://example.test/googlechat/two",
    }));

    let capturedAgentKey: string | undefined;
    let capturedTurn: unknown;
    const agents = {
      getRuntime: async ({ agentKey }: { agentKey: string }) => {
        capturedAgentKey = agentKey;
        return {
          turn: async (input: unknown) => {
            capturedTurn = input;
            return {
              reply: "Hello from Tyrum",
              conversation_id: "11111111-1111-4111-8111-111111111111",
              conversation_key: "agent:agent-b:googlechat:default:dm:users/123",
            };
          },
        };
      },
    } as never;

    const app = new Hono();
    app.route(
      "/",
      createIngressRoutes({
        googleChatRuntime: createGoogleChatRuntime(),
        agents,
      }),
    );

    const res = await app.request("/ingress/googlechat", {
      method: "POST",
      headers: {
        authorization: "Bearer test-token",
        "content-type": "application/json",
      },
      body: JSON.stringify(createEvent()),
    });

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ text: "Hello from Tyrum" });
    expect(capturedAgentKey).toBe("agent-b");
    expect(capturedTurn).toMatchObject({
      channel: "googlechat",
      thread_id: "users/123",
      envelope: {
        delivery: {
          channel: "googlechat",
          account: "two",
        },
        container: {
          kind: "dm",
          id: "users/123",
        },
        sender: {
          id: "users/123",
          display: "Alice",
        },
        content: {
          text: "Hello from chat",
        },
      },
    });
  });

  it("ignores Google Chat senders outside the configured allowlist", async () => {
    await seedGoogleChatAccount({
      accountKey: "chat",
      agentKey: "default",
      audience: "https://example.test/googlechat",
      allowedUsers: ["users/999"],
    });
    vi.mocked(verifyGoogleChatRequest).mockResolvedValue({ ok: true });

    let turnCalled = false;
    const app = new Hono();
    app.route(
      "/",
      createIngressRoutes({
        googleChatRuntime: createGoogleChatRuntime(),
        agents: {
          getRuntime: async () => ({
            turn: async () => {
              turnCalled = true;
              return {
                reply: "ignored",
                conversation_id: "11111111-1111-4111-8111-111111111111",
                conversation_key: "agent:default:googlechat:default:dm:users/123",
              };
            },
          }),
        } as never,
      }),
    );

    const res = await app.request("/ingress/googlechat", {
      method: "POST",
      headers: {
        authorization: "Bearer test-token",
        "content-type": "application/json",
      },
      body: JSON.stringify(createEvent()),
    });

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({});
    expect(turnCalled).toBe(false);
  });

  it("rejects ambiguous Google Chat verification when multiple accounts match", async () => {
    await seedGoogleChatAccount({
      accountKey: "one",
      agentKey: "default",
      audience: "https://example.test/googlechat/one",
    });
    await seedGoogleChatAccount({
      accountKey: "two",
      agentKey: "agent-b",
      audience: "https://example.test/googlechat/two",
    });
    vi.mocked(verifyGoogleChatRequest).mockResolvedValue({ ok: true });

    const app = new Hono();
    app.route(
      "/",
      createIngressRoutes({
        googleChatRuntime: createGoogleChatRuntime(),
      }),
    );

    const res = await app.request("/ingress/googlechat", {
      method: "POST",
      headers: {
        authorization: "Bearer test-token",
        "content-type": "application/json",
      },
      body: JSON.stringify(createEvent()),
    });

    expect(res.status).toBe(401);
    await expect(res.json()).resolves.toMatchObject({
      error: "unauthorized",
      message: "invalid google chat bearer",
    });
  });
});
