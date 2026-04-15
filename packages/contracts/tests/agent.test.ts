import { describe, expect, it } from "vitest";
import { AgentConfig, BuiltinMemoryServerSettings } from "../src/index.js";
import { expectRejects } from "./test-helpers.js";

const LEGACY_NODE_DISPATCH_TOOL_ID = ["tool", "node", "dispatch"].join(".");

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
    expect(parsed.mcp.bundle).toBeUndefined();
    expect(parsed.mcp.tier).toBeUndefined();
    expect(parsed.mcp.pre_turn_tools).toEqual([]);
    expect(parsed.mcp.server_settings).toEqual({});
    expect(parsed.tools.default_mode).toBe("allow");
    expect(parsed.tools.allow).toEqual([]);
    expect(parsed.tools.deny).toEqual([]);
    expect(parsed.tools.bundle).toBeUndefined();
    expect(parsed.tools.tier).toBeUndefined();
    expect(parsed.conversations.ttl_days).toBe(365);
    expect(parsed.conversations.max_turns).toBe(0);
    expect(parsed.conversations.compaction.auto).toBe(true);
    expect(parsed.conversations.compaction.reserved_input_tokens).toBe(20_000);
    expect(parsed.conversations.compaction.keep_last_messages_after_compaction).toBe(2);
    expect(parsed.conversations.loop_detection.within_turn.enabled).toBe(true);
    expect(parsed.conversations.loop_detection.within_turn.consecutive_repeat_limit).toBe(3);
    expect(parsed.conversations.loop_detection.within_turn.cycle_repeat_limit).toBe(3);
    expect(parsed.conversations.loop_detection.cross_turn.enabled).toBe(true);
    expect(parsed.conversations.loop_detection.cross_turn.window_assistant_messages).toBe(3);
    expect(parsed.conversations.loop_detection.cross_turn.similarity_threshold).toBe(0.97);
    expect(parsed.conversations.loop_detection.cross_turn.min_chars).toBe(120);
    expect(parsed.conversations.loop_detection.cross_turn.cooldown_assistant_messages).toBe(6);
    expect(parsed.persona).toBeUndefined();
    expect(parsed.secret_refs).toEqual([]);
  });

  it("parses MCP-native built-in memory settings", () => {
    const parsed = AgentConfig.parse({
      model: { model: "openai/gpt-5.4" },
      mcp: {
        pre_turn_tools: ["mcp.memory.seed"],
        server_settings: {
          memory: {
            enabled: true,
            allow_sensitivities: ["public"],
            keyword: { enabled: false, limit: 25 },
          },
        },
      },
    });

    expect(parsed.mcp.pre_turn_tools).toEqual(["memory.seed"]);
    expect(BuiltinMemoryServerSettings.parse(parsed.mcp.server_settings["memory"])).toMatchObject({
      enabled: true,
      allow_sensitivities: ["public"],
      keyword: { enabled: false, limit: 25 },
    });
  });

  it("canonicalizes memory aliases in tool allow and deny lists", () => {
    const parsed = AgentConfig.parse({
      model: { model: "openai/gpt-5.4" },
      tools: {
        allow: ["mcp.memory.search", "memory.search"],
        deny: ["mcp.memory.write"],
      },
    });

    expect(parsed.tools.allow).toEqual(["memory.search"]);
    expect(parsed.tools.deny).toEqual(["memory.write"]);
  });

  it("rejects legacy memory.v1 config", () => {
    expectRejects(AgentConfig, {
      model: { model: "openai/gpt-5.4" },
      memory: {
        v1: {
          enabled: true,
        },
      },
    });
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
      conversations: { context_pruning: { max_messages: 0 } },
    });
    const bounded = AgentConfig.parse({
      model: { model: "openai/gpt-5.4" },
      conversations: { context_pruning: { max_messages: 8 } },
    });

    expect(unlimited.conversations.context_pruning.max_messages).toBe(0);
    expect(bounded.conversations.context_pruning.max_messages).toBe(8);
  });

  it("rejects too-small positive context pruning limits", () => {
    expectRejects(AgentConfig, {
      model: { model: "openai/gpt-5.4" },
      conversations: { context_pruning: { max_messages: 4 } },
    });
  });

  it("accepts canonical tool allowlists", () => {
    const parsed = AgentConfig.parse({
      model: { model: "openai/gpt-5.4" },
      tools: { allow: ["read", "bash"] },
    });

    expect(parsed.tools.allow).toEqual(["read", "bash"]);
  });

  it("accepts canonical tool exposure selectors for MCP and tools", () => {
    const parsed = AgentConfig.parse({
      model: { model: "openai/gpt-5.4" },
      mcp: {
        bundle: "workspace-default",
        tier: "advanced",
      },
      tools: {
        bundle: "authoring-core",
        tier: "default",
      },
    });

    expect(parsed.mcp.bundle).toBe("workspace-default");
    expect(parsed.mcp.tier).toBe("advanced");
    expect(parsed.tools.bundle).toBe("authoring-core");
    expect(parsed.tools.tier).toBe("default");
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

  it("parses agent-scoped secret references as metadata only", () => {
    const parsed = AgentConfig.parse({
      model: { model: "openai/gpt-5.4" },
      secret_refs: [
        {
          secret_ref_id: "sec_ref_prod_db",
          secret_alias: "prod-db-password",
          allowed_tool_ids: ["tool.secret.copy-to-node-clipboard"],
          display_name: "Production DB password",
        },
      ],
    });

    expect(parsed.secret_refs).toEqual([
      {
        secret_ref_id: "sec_ref_prod_db",
        secret_alias: "prod-db-password",
        allowed_tool_ids: ["tool.secret.copy-to-node-clipboard"],
        display_name: "Production DB password",
      },
    ]);
  });

  it("rejects generic node helpers in allowed secret tool ids", () => {
    expectRejects(AgentConfig, {
      model: { model: "openai/gpt-5.4" },
      secret_refs: [
        {
          secret_ref_id: "sec_ref_prod_db",
          allowed_tool_ids: [LEGACY_NODE_DISPATCH_TOOL_ID],
        },
      ],
    });
  });

  it("rejects duplicate secret aliases within an agent config", () => {
    expectRejects(AgentConfig, {
      model: { model: "openai/gpt-5.4" },
      secret_refs: [
        {
          secret_ref_id: "sec_ref_prod_db",
          secret_alias: "shared-alias",
          allowed_tool_ids: ["tool.secret.copy-to-node-clipboard"],
        },
        {
          secret_ref_id: "sec_ref_prod_api",
          secret_alias: "shared-alias",
          allowed_tool_ids: ["tool.secret.copy-to-node-clipboard"],
        },
      ],
    });
  });
});
