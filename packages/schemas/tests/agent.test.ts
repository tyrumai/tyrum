import { describe, expect, it } from "vitest";
import {
  AgentConfig,
  IdentityPack,
  SkillManifest,
  McpServerSpec,
  AgentTurnRequest,
} from "../src/index.js";
import { expectRejects } from "./test-helpers.js";

describe("AgentConfig", () => {
  it("parses and applies defaults", () => {
    const parsed = AgentConfig.parse({
      model: {
        model: "openai/gpt-5.4",
      },
    });

    expect(parsed.model.model).toBe("openai/gpt-5.4");
    expect(parsed.skills.default_mode).toBe("allow");
    expect(parsed.skills.allow).toEqual([]);
    expect(parsed.skills.deny).toEqual([]);
    expect(parsed.skills.workspace_trusted).toBe(true);
    expect(parsed.mcp.default_mode).toBe("allow");
    expect(parsed.mcp.allow).toEqual([]);
    expect(parsed.mcp.deny).toEqual([]);
    expect(parsed.tools.default_mode).toBe("allow");
    expect(parsed.tools.allow).toEqual([]);
    expect(parsed.tools.deny).toEqual([]);
    expect(parsed.sessions.ttl_days).toBe(365);
    expect(parsed.sessions.max_turns).toBe(0);
    expect(parsed.sessions.compaction.auto).toBe(true);
    expect(parsed.sessions.compaction.reserved_input_tokens).toBe(20_000);
    expect(parsed.sessions.compaction.keep_last_messages_after_compaction).toBe(2);
    expect(parsed.sessions.loop_detection.within_turn.enabled).toBe(true);
    expect(parsed.sessions.loop_detection.within_turn.consecutive_repeat_limit).toBe(3);
    expect(parsed.sessions.loop_detection.within_turn.cycle_repeat_limit).toBe(3);
    expect(parsed.sessions.loop_detection.cross_turn.enabled).toBe(true);
    expect(parsed.sessions.loop_detection.cross_turn.window_assistant_messages).toBe(3);
    expect(parsed.sessions.loop_detection.cross_turn.similarity_threshold).toBe(0.97);
    expect(parsed.sessions.loop_detection.cross_turn.min_chars).toBe(120);
    expect(parsed.sessions.loop_detection.cross_turn.cooldown_assistant_messages).toBe(6);
    expect(parsed.memory.v1.enabled).toBe(true);
    expect(parsed.memory.v1.auto_write.enabled).toBe(true);
    expect(parsed.memory.v1.auto_write.mode).toBe("sparse");
    expect(parsed.memory.v1.auto_write.classifier).toBe("model_assisted");
    expect(parsed.memory.v1.allow_sensitivities).toEqual(["public", "private"]);
    expect(parsed.memory.v1.semantic.enabled).toBe(true);
    expect(parsed.memory.v1.budgets.max_total_items).toBeGreaterThan(0);
    expect(parsed.memory.v1.budgets.max_total_chars).toBeGreaterThan(0);
    expect(parsed.memory.v1.budgets.per_kind.fact.max_items).toBeGreaterThan(0);
    expect(parsed.memory.v1.budgets.per_kind.note.max_items).toBeGreaterThan(0);
    expect(parsed.memory.v1.budgets.per_kind.procedure.max_items).toBeGreaterThan(0);
    expect(parsed.memory.v1.budgets.per_kind.episode.max_items).toBeGreaterThan(0);
    expect(parsed.persona).toBeUndefined();
  });

  it("parses persisted persona fields", () => {
    const parsed = AgentConfig.parse({
      model: {
        model: "openai/gpt-4.1",
      },
      persona: {
        name: "Hypatia",
        tone: "direct",
        palette: "graphite",
        character: "architect",
      },
    });

    expect(parsed.persona).toEqual({
      name: "Hypatia",
      tone: "direct",
      palette: "graphite",
      character: "architect",
    });
  });

  it("rejects non-object model config", () => {
    expectRejects(AgentConfig, { model: "openai/gpt-4.1" });
  });

  it("rejects model.model with wrong type", () => {
    expectRejects(AgentConfig, { model: { model: 42 } });
  });

  it("accepts unlimited and bounded context pruning limits", () => {
    const unlimited = AgentConfig.parse({
      model: { model: "openai/gpt-5.4" },
      sessions: { context_pruning: { max_messages: 0 } },
    });
    const bounded = AgentConfig.parse({
      model: { model: "openai/gpt-5.4" },
      sessions: { context_pruning: { max_messages: 8 } },
    });

    expect(unlimited.sessions.context_pruning.max_messages).toBe(0);
    expect(bounded.sessions.context_pruning.max_messages).toBe(8);
  });

  it("rejects too-small positive context pruning limits", () => {
    expectRejects(AgentConfig, {
      model: { model: "openai/gpt-5.4" },
      sessions: { context_pruning: { max_messages: 4 } },
    });
  });

  it("accepts canonical tool allowlists", () => {
    const parsed = AgentConfig.parse({
      model: { model: "openai/gpt-5.4" },
      tools: { allow: ["read", "bash"] },
    });

    expect(parsed.tools.allow).toEqual(["read", "bash"]);
  });

  it("rejects overlapping access overrides", () => {
    expectRejects(AgentConfig, {
      model: { model: "openai/gpt-5.4" },
      tools: { allow: ["read"], deny: ["read"] },
    });
  });

  it("normalizes legacy allow-all wildcards to default allow", () => {
    const parsed = AgentConfig.parse({
      model: { model: "openai/gpt-5.4" },
      tools: { allow: ["tool.*"] },
    });

    expect(parsed.tools.default_mode).toBe("allow");
    expect(parsed.tools.allow).toEqual([]);
    expect(parsed.tools.deny).toEqual([]);
  });
});

describe("IdentityPack", () => {
  it("parses a valid identity payload", () => {
    const parsed = IdentityPack.parse({
      meta: {
        name: "Tyrum",
        style: {
          tone: "direct",
        },
      },
    });

    expect(parsed.meta.name).toBe("Tyrum");
    expect(parsed.meta.style?.tone).toBe("direct");
  });

  it("strips legacy identity body fields", () => {
    const parsed = IdentityPack.parse({
      meta: {
        name: "Tyrum",
        style: { tone: "direct" },
      },
      body: "You are Tyrum.",
    });

    expect(parsed).toEqual({
      meta: {
        name: "Tyrum",
        style: { tone: "direct" },
      },
    });
  });

  it("rejects identity payload with blank tone", () => {
    expectRejects(IdentityPack, {
      meta: { name: "Tyrum", style: { tone: "   " } },
    });
  });
});

describe("SkillManifest", () => {
  it("requires id, name, and version", () => {
    const parsed = SkillManifest.parse({
      meta: {
        id: "local-files",
        name: "Local Files",
        version: "1.0.0",
        requires: {
          tools: ["read"],
        },
      },
      body: "Use filesystem tools carefully.",
    });

    expect(parsed.meta.id).toBe("local-files");
    expect(parsed.meta.requires?.tools).toEqual(["read"]);
  });

  it("rejects SkillManifest missing meta.id", () => {
    expectRejects(SkillManifest, { meta: { name: "Local Files", version: "1.0.0" }, body: "x" });
  });

  it("rejects SkillManifest with non-array requires.tools", () => {
    expectRejects(SkillManifest, {
      meta: { id: "local-files", name: "Local Files", version: "1.0.0", requires: { tools: "*" } },
      body: "x",
    });
  });
});

describe("McpServerSpec", () => {
  it("parses stdio server configuration", () => {
    const parsed = McpServerSpec.parse({
      id: "calendar",
      name: "Calendar MCP",
      enabled: true,
      transport: "stdio",
      command: "node",
      args: ["./mcp/calendar.js"],
      env: {
        CALENDAR_TOKEN: "${CALENDAR_TOKEN}",
      },
    });

    expect(parsed.transport).toBe("stdio");
    expect(parsed.command).toBe("node");
  });

  it("rejects stdio server config missing command", () => {
    expectRejects(McpServerSpec, { id: "calendar", name: "Calendar MCP", enabled: true });
  });

  it("rejects remote server config missing url", () => {
    expectRejects(McpServerSpec, {
      id: "calendar-remote",
      name: "Calendar MCP (Remote)",
      enabled: true,
      transport: "remote",
    });
  });

  it("parses remote server configuration", () => {
    const parsed = McpServerSpec.parse({
      id: "calendar-remote",
      name: "Calendar MCP (Remote)",
      enabled: true,
      transport: "remote",
      url: "https://mcp.example.com/mcp",
      headers: {
        authorization: "Bearer ${MCP_TOKEN}",
      },
    });

    expect(parsed.transport).toBe("remote");
    expect(parsed.url).toBe("https://mcp.example.com/mcp");
  });
});

describe("AgentTurnRequest", () => {
  const baseEnvelope = {
    message_id: "msg-1",
    received_at: "2025-10-05T16:31:09Z",
    delivery: {
      channel: "telegram",
      account: "default",
    },
    container: {
      kind: "dm",
      id: "chat-123",
    },
    sender: {
      id: "user-42",
    },
    content: {
      attachments: [{ kind: "photo" }],
    },
    provenance: ["user"],
  } as const;

  it("accepts an envelope-only request with attachments", () => {
    const parsed = AgentTurnRequest.safeParse({
      envelope: baseEnvelope,
    });

    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    expect(parsed.data.envelope?.content.attachments).toEqual([{ kind: "photo" }]);
  });

  it("rejects envelope requests with mismatched channel", () => {
    expectRejects(AgentTurnRequest, {
      envelope: baseEnvelope,
      channel: "discord",
    });
  });

  it("rejects envelope requests with mismatched thread_id", () => {
    expectRejects(AgentTurnRequest, {
      envelope: baseEnvelope,
      thread_id: "chat-456",
    });
  });

  it("rejects requests missing channel when envelope is not provided", () => {
    expectRejects(AgentTurnRequest, { thread_id: "chat-123", message: "hi" });
  });

  it("rejects requests missing thread_id when envelope is not provided", () => {
    expectRejects(AgentTurnRequest, { channel: "telegram", message: "hi" });
  });

  it("rejects blank message content", () => {
    const parsed = AgentTurnRequest.safeParse({
      channel: "telegram",
      thread_id: "123",
      message: "   ",
    });

    expect(parsed.success).toBe(false);
  });
});
