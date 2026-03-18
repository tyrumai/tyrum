import { describe, expect, it, vi } from "vitest";
import { handleDiscordMessageCreate } from "../../src/modules/channels/discord-monitor.js";

describe("discord monitor", () => {
  it("routes DM messages to the configured agent and sends a reply", async () => {
    const fetchMock = vi.fn(
      async () => new Response(JSON.stringify({ id: "message-1" }), { status: 200 }),
    );
    let capturedAgentKey: string | undefined;
    let capturedTurn: unknown;

    await handleDiscordMessageCreate({
      message: {
        id: "100",
        channel_id: "200",
        content: "Hello from Discord",
        author: {
          id: "300",
          username: "alice",
          bot: false,
        },
      },
      account: {
        channel: "discord",
        account_key: "community",
        agent_key: "agent-b",
        bot_token: "discord-bot-token",
        allowed_user_ids: [],
        allowed_channels: [],
      },
      agents: {
        getRuntime: async ({ agentKey }: { agentKey: string }) => {
          capturedAgentKey = agentKey;
          return {
            turn: async (input: unknown) => {
              capturedTurn = input;
              return {
                reply: "Reply from Tyrum",
                session_id: "11111111-1111-4111-8111-111111111111",
                session_key: "agent:agent-b:discord:default:dm:300",
              };
            },
          };
        },
      } as never,
      fetchImpl: fetchMock as unknown as typeof fetch,
    });

    expect(capturedAgentKey).toBe("agent-b");
    expect(capturedTurn).toMatchObject({
      channel: "discord",
      thread_id: "300",
      envelope: {
        delivery: { channel: "discord", account: "community" },
        container: { kind: "dm", id: "300" },
        sender: { id: "300", display: "alice" },
        content: { text: "Hello from Discord" },
      },
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "https://discord.com/api/v10/channels/200/messages",
      expect.objectContaining({
        method: "POST",
      }),
    );
  });

  it("accepts thread messages when the parent guild channel is allowlisted", async () => {
    const fetchMock = vi.fn(
      async () => new Response(JSON.stringify({ id: "message-1" }), { status: 200 }),
    );
    let turnCalled = false;

    await handleDiscordMessageCreate({
      message: {
        id: "100",
        guild_id: "guild-1",
        channel_id: "thread-1",
        parent_id: "channel-1",
        content: "Hello from a thread",
        author: {
          id: "300",
          username: "alice",
          bot: false,
        },
      },
      account: {
        channel: "discord",
        account_key: "community",
        agent_key: "agent-b",
        bot_token: "discord-bot-token",
        allowed_user_ids: [],
        allowed_channels: ["guild:guild-1/channel:channel-1"],
      },
      agents: {
        getRuntime: async () => ({
          turn: async () => {
            turnCalled = true;
            return {
              reply: "Reply from Tyrum",
              session_id: "11111111-1111-4111-8111-111111111111",
              session_key: "agent:agent-b:discord:default:group:thread-1",
            };
          },
        }),
      } as never,
      fetchImpl: fetchMock as unknown as typeof fetch,
    });

    expect(turnCalled).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("blocks disallowed guild messages before agent execution", async () => {
    const fetchMock = vi.fn(
      async () => new Response(JSON.stringify({ id: "message-1" }), { status: 200 }),
    );
    let turnCalled = false;

    await handleDiscordMessageCreate({
      message: {
        id: "100",
        guild_id: "guild-1",
        channel_id: "channel-1",
        content: "Hello from Discord",
        author: {
          id: "300",
          username: "alice",
          bot: false,
        },
      },
      account: {
        channel: "discord",
        account_key: "community",
        agent_key: "agent-b",
        bot_token: "discord-bot-token",
        allowed_user_ids: ["999"],
        allowed_channels: ["guild:guild-2"],
      },
      agents: {
        getRuntime: async () => ({
          turn: async () => {
            turnCalled = true;
            return {
              reply: "Reply from Tyrum",
              session_id: "11111111-1111-4111-8111-111111111111",
              session_key: "agent:agent-b:discord:default:group:channel-1",
            };
          },
        }),
      } as never,
      fetchImpl: fetchMock as unknown as typeof fetch,
    });

    expect(turnCalled).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
