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
        model: "openai/gpt-4.1",
      },
    });

    expect(parsed.model.model).toBe("openai/gpt-4.1");
    expect(parsed.skills.enabled).toEqual([]);
    expect(parsed.skills.workspace_trusted).toBe(false);
    expect(parsed.mcp.enabled).toEqual([]);
    expect(parsed.tools.allow).toEqual([]);
    expect(parsed.sessions.ttl_days).toBe(30);
    expect(parsed.sessions.max_turns).toBe(20);
    expect(parsed.sessions.loop_detection.within_turn.enabled).toBe(true);
    expect(parsed.sessions.loop_detection.within_turn.consecutive_repeat_limit).toBe(3);
    expect(parsed.sessions.loop_detection.within_turn.cycle_repeat_limit).toBe(3);
    expect(parsed.sessions.loop_detection.cross_turn.enabled).toBe(true);
    expect(parsed.sessions.loop_detection.cross_turn.window_assistant_messages).toBe(3);
    expect(parsed.sessions.loop_detection.cross_turn.similarity_threshold).toBe(0.97);
    expect(parsed.sessions.loop_detection.cross_turn.min_chars).toBe(120);
    expect(parsed.sessions.loop_detection.cross_turn.cooldown_assistant_messages).toBe(6);
    expect(parsed.memory.markdown_enabled).toBe(true);
    expect(parsed.memory.v1.enabled).toBe(true);
    expect(parsed.memory.v1.allow_sensitivities).toEqual(["public", "private"]);
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
        description: "Calm systems thinker.",
        tone: "direct",
        palette: "graphite",
        character: "architect",
      },
    });

    expect(parsed.persona).toEqual({
      name: "Hypatia",
      description: "Calm systems thinker.",
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
});

describe("IdentityPack", () => {
  it("parses a valid identity payload", () => {
    const parsed = IdentityPack.parse({
      meta: {
        name: "Tyrum",
        style: {
          tone: "direct",
          verbosity: "concise",
        },
      },
      body: "You are Tyrum.",
    });

    expect(parsed.meta.name).toBe("Tyrum");
    expect(parsed.body).toContain("Tyrum");
  });

  it("rejects identity payload missing body", () => {
    expectRejects(IdentityPack, {
      meta: {
        name: "Tyrum",
        style: { tone: "direct", verbosity: "concise" },
      },
    });
  });

  it("rejects identity payload with blank verbosity", () => {
    expectRejects(IdentityPack, {
      meta: { name: "Tyrum", style: { tone: "direct", verbosity: "   " } },
      body: "You are Tyrum.",
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
          tools: ["tool.fs.read"],
        },
      },
      body: "Use filesystem tools carefully.",
    });

    expect(parsed.meta.id).toBe("local-files");
    expect(parsed.meta.requires?.tools).toEqual(["tool.fs.read"]);
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
