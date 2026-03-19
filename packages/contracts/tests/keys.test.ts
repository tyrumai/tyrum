import { describe, expect, it } from "vitest";
import {
  DmScope,
  HookKey,
  Lane,
  QueueMode,
  TyrumKey,
  buildAgentSessionKey,
  parseTyrumKey,
  resolveDmScope,
} from "../src/index.js";
import { expectRejects } from "./test-helpers.js";

describe("Lane", () => {
  it("accepts known lanes", () => {
    expect(Lane.parse("main")).toBe("main");
    expect(Lane.parse("cron")).toBe("cron");
    expect(Lane.parse("heartbeat")).toBe("heartbeat");
    expect(Lane.parse("subagent")).toBe("subagent");
  });

  it("rejects unknown lanes", () => {
    expectRejects(Lane, "oops");
  });
});

describe("DmScope", () => {
  it("accepts known dm scopes", () => {
    expect(DmScope.parse("shared")).toBe("shared");
    expect(DmScope.parse("per_peer")).toBe("per_peer");
    expect(DmScope.parse("per_channel_peer")).toBe("per_channel_peer");
    expect(DmScope.parse("per_account_channel_peer")).toBe("per_account_channel_peer");
  });

  it("rejects unknown dm scopes", () => {
    expectRejects(DmScope, "global");
  });
});

describe("QueueMode", () => {
  it("accepts known queue modes", () => {
    expect(QueueMode.parse("collect")).toBe("collect");
    expect(QueueMode.parse("followup")).toBe("followup");
    expect(QueueMode.parse("steer")).toBe("steer");
    expect(QueueMode.parse("steer_backlog")).toBe("steer_backlog");
    expect(QueueMode.parse("interrupt")).toBe("interrupt");
  });

  it("rejects unknown queue modes", () => {
    expectRejects(QueueMode, "fast");
  });
});

describe("TyrumKey", () => {
  it("parses canonical direct shared key", () => {
    const key = TyrumKey.parse("agent:agent-1:main");
    expect(parseTyrumKey(key)).toEqual({
      kind: "agent",
      agent_key: "agent-1",
      thread_kind: "main",
    });
  });

  it("parses canonical direct per-peer key", () => {
    const key = TyrumKey.parse("agent:agent-1:dm:user-1");
    expect(parseTyrumKey(key)).toEqual({
      kind: "agent",
      agent_key: "agent-1",
      thread_kind: "dm",
      dm_scope: "per_peer",
      peer_id: "user-1",
    });
  });

  it("parses canonical direct per-channel-peer key", () => {
    const key = TyrumKey.parse("agent:agent-1:telegram:dm:user-1");
    expect(parseTyrumKey(key)).toEqual({
      kind: "agent",
      agent_key: "agent-1",
      thread_kind: "dm",
      dm_scope: "per_channel_peer",
      channel: "telegram",
      peer_id: "user-1",
    });
  });

  it("parses canonical direct per-account-channel-peer key", () => {
    const key = TyrumKey.parse("agent:agent-1:telegram:work:dm:user-1");
    expect(parseTyrumKey(key)).toEqual({
      kind: "agent",
      agent_key: "agent-1",
      thread_kind: "dm",
      dm_scope: "per_account_channel_peer",
      channel: "telegram",
      account: "work",
      peer_id: "user-1",
    });
  });

  it("parses canonical group key", () => {
    const key = TyrumKey.parse("agent:a1:discord:work:group:999");
    expect(parseTyrumKey(key)).toEqual({
      kind: "agent",
      agent_key: "a1",
      channel: "discord",
      account: "work",
      thread_kind: "group",
      id: "999",
    });
  });

  it("parses cron key", () => {
    const key = TyrumKey.parse("cron:daily-report");
    expect(parseTyrumKey(key)).toEqual({ kind: "cron", job_id: "daily-report" });
  });

  it("parses hook key", () => {
    const key = TyrumKey.parse("hook:550e8400-e29b-41d4-a716-446655440000");
    expect(parseTyrumKey(key)).toEqual({
      kind: "hook",
      uuid: "550e8400-e29b-41d4-a716-446655440000",
    });
  });

  it("parses node key", () => {
    const key = TyrumKey.parse("node:node-123");
    expect(parseTyrumKey(key)).toEqual({ kind: "node", node_id: "node-123" });
  });

  it("rejects invalid key strings", () => {
    expectRejects(TyrumKey, "not-a-key");
  });

  it("parseTyrumKey throws on missing agent_id", () => {
    expect(() => parseTyrumKey("agent:" as unknown as TyrumKey)).toThrow(/invalid agent key/);
  });

  it("parseTyrumKey throws on empty cron job_id", () => {
    expect(() => parseTyrumKey("cron:" as unknown as TyrumKey)).toThrow(/invalid cron key/);
  });

  it("parseTyrumKey throws on empty hook uuid", () => {
    expect(() => parseTyrumKey("hook:" as unknown as TyrumKey)).toThrow(/invalid hook key/);
  });

  it("parseTyrumKey throws on empty node id", () => {
    expect(() => parseTyrumKey("node:" as unknown as TyrumKey)).toThrow(/invalid node key/);
  });
});

describe("HookKey", () => {
  it("rejects non-uuid hook keys", () => {
    expect(() => HookKey.parse("hook:not-a-uuid")).toThrow();
  });
});

describe("resolveDmScope", () => {
  it("uses secure default when distinct dm senders exceed one", () => {
    expect(resolveDmScope({ distinctDmSenders: 2 })).toBe("per_account_channel_peer");
  });

  it("uses shared default for single-sender dm surfaces", () => {
    expect(resolveDmScope({ distinctDmSenders: 1 })).toBe("shared");
  });

  it("defaults to secure mode when dm sender count is unknown", () => {
    expect(resolveDmScope()).toBe("per_account_channel_peer");
  });

  it("honors explicit configured scope", () => {
    expect(
      resolveDmScope({
        configured: "per_channel_peer",
        distinctDmSenders: 10,
      }),
    ).toBe("per_channel_peer");
  });
});

describe("buildAgentSessionKey", () => {
  it("builds canonical shared dm key", () => {
    expect(
      buildAgentSessionKey({
        agentKey: "agent-1",
        container: "dm",
        channel: "telegram",
        account: "work",
        peerId: "user-1",
        dmScope: "shared",
      }),
    ).toBe("agent:agent-1:main");
  });

  it("builds canonical per-peer dm key", () => {
    expect(
      buildAgentSessionKey({
        agentKey: "agent-1",
        container: "dm",
        channel: "telegram",
        account: "work",
        peerId: "user-1",
        dmScope: "per_peer",
      }),
    ).toBe("agent:agent-1:dm:user-1");
  });

  it("builds canonical per-channel-peer dm key", () => {
    expect(
      buildAgentSessionKey({
        agentKey: "agent-1",
        container: "dm",
        channel: "telegram",
        account: "work",
        peerId: "user-1",
        dmScope: "per_channel_peer",
      }),
    ).toBe("agent:agent-1:telegram:dm:user-1");
  });

  it("builds canonical per-account-channel-peer dm key", () => {
    expect(
      buildAgentSessionKey({
        agentKey: "agent-1",
        container: "dm",
        channel: "telegram",
        account: "work",
        peerId: "user-1",
        dmScope: "per_account_channel_peer",
      }),
    ).toBe("agent:agent-1:telegram:work:dm:user-1");
  });

  it("defaults to secure dm scope when none is provided", () => {
    expect(
      buildAgentSessionKey({
        agentKey: "agent-1",
        container: "dm",
        channel: "telegram",
        account: "work",
        peerId: "user-1",
      }),
    ).toBe("agent:agent-1:telegram:work:dm:user-1");
  });

  it("builds canonical group key", () => {
    expect(
      buildAgentSessionKey({
        agentKey: "agent-1",
        container: "group",
        channel: "telegram",
        account: "work",
        id: "group-42",
      }),
    ).toBe("agent:agent-1:telegram:work:group:group-42");
  });

  it("builds canonical channel key", () => {
    expect(
      buildAgentSessionKey({
        agentKey: "agent-1",
        container: "channel",
        channel: "telegram",
        account: "work",
        id: "chan-7",
      }),
    ).toBe("agent:agent-1:telegram:work:channel:chan-7");
  });
});
