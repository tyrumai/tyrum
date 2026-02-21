import { describe, expect, it } from "vitest";
import {
  HookKey,
  Lane,
  QueueMode,
  TyrumKey,
  parseTyrumKey,
} from "../src/index.js";

describe("Lane", () => {
  it("accepts known lanes", () => {
    expect(Lane.parse("main")).toBe("main");
    expect(Lane.parse("cron")).toBe("cron");
    expect(Lane.parse("subagent")).toBe("subagent");
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
});

describe("TyrumKey", () => {
  it("parses agent main key", () => {
    const key = TyrumKey.parse("agent:agent-1:main");
    expect(parseTyrumKey(key)).toEqual({
      kind: "agent",
      agent_id: "agent-1",
      thread_kind: "main",
    });
  });

  it("parses agent dm key (per account + channel + peer)", () => {
    const key = TyrumKey.parse("agent:agent-1:telegram:default:dm:999");
    expect(parseTyrumKey(key)).toEqual({
      kind: "agent",
      agent_id: "agent-1",
      thread_kind: "dm",
      channel: "telegram",
      account_id: "default",
      peer_id: "999",
    });
  });

  it("parses agent group key", () => {
    const key = TyrumKey.parse("agent:a1:discord:default:group:999");
    expect(parseTyrumKey(key)).toEqual({
      kind: "agent",
      agent_id: "a1",
      channel: "discord",
      account_id: "default",
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
});

describe("HookKey", () => {
  it("rejects non-uuid hook keys", () => {
    expect(() => HookKey.parse("hook:not-a-uuid")).toThrow();
  });
});
