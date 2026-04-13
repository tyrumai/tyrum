import { describe, expect, it } from "vitest";
import {
  AgentConfig,
  AgentCapabilitiesResponse,
  AgentSecretReference,
  BuiltinMemoryServerSettings,
  IdentityPack,
  McpServerSpec,
  SkillManifest,
  AgentTurnRequest,
} from "../src/index.js";
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

describe("AgentSecretReference", () => {
  it("rejects unexpected raw secret fields", () => {
    expectRejects(AgentSecretReference, {
      secret_ref_id: "sec_ref_prod_db",
      allowed_tool_ids: ["tool.secret.copy-to-node-clipboard"],
      value: "plaintext-should-not-appear-here",
    });
  });
});

describe("AgentCapabilitiesResponse", () => {
  it("parses workspace skill trust in capability payloads", () => {
    const parsed = AgentCapabilitiesResponse.parse({
      skills: {
        default_mode: "allow",
        allow: [],
        deny: [],
        workspace_trusted: true,
        items: [],
      },
      mcp: {
        default_mode: "allow",
        allow: [],
        deny: [],
        items: [],
      },
      tools: {
        default_mode: "allow",
        allow: [],
        deny: [],
        items: [],
      },
    });

    expect(parsed.skills.workspace_trusted).toBe(true);
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

  it("parses MCP tool metadata overrides", () => {
    const parsed = McpServerSpec.parse({
      id: "calendar",
      name: "Calendar MCP",
      enabled: true,
      transport: "stdio",
      command: "node",
      tool_overrides: {
        sync: {
          description_append: "Use for durable calendar hydration.",
          effect: "read_only",
          pre_turn_hydration: {
            prompt_arg_name: "query",
            include_turn_context: true,
          },
          memory_role: "seed",
        },
      },
    });

    expect(parsed.tool_overrides?.["sync"]).toEqual({
      description_append: "Use for durable calendar hydration.",
      effect: "read_only",
      pre_turn_hydration: {
        prompt_arg_name: "query",
        include_turn_context: true,
      },
      memory_role: "seed",
    });
  });

  it("rejects MCP tool overrides with conflicting description fields", () => {
    expectRejects(McpServerSpec, {
      id: "calendar",
      name: "Calendar MCP",
      enabled: true,
      transport: "stdio",
      command: "node",
      tool_overrides: {
        sync: {
          description_override: "Override",
          description_append: "Append",
        },
      },
    });
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
      attachments: [
        {
          artifact_id: "550e8400-e29b-41d4-a716-446655440000",
          uri: "artifact://550e8400-e29b-41d4-a716-446655440000",
          external_url: "https://example.test/a/550e8400-e29b-41d4-a716-446655440000",
          kind: "file",
          media_class: "image",
          created_at: "2025-10-05T16:31:09Z",
          mime_type: "image/jpeg",
          filename: "photo.jpg",
          labels: [],
        },
      ],
    },
    provenance: ["user"],
  } as const;

  it("accepts an envelope-only request with attachments", () => {
    const parsed = AgentTurnRequest.safeParse({
      envelope: baseEnvelope,
    });

    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    expect(parsed.data.envelope?.content.attachments).toEqual(baseEnvelope.content.attachments);
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
    expectRejects(AgentTurnRequest, {
      thread_id: "chat-123",
      parts: [{ type: "text", text: "hi" }],
    });
  });

  it("rejects requests missing thread_id when envelope is not provided", () => {
    expectRejects(AgentTurnRequest, {
      channel: "telegram",
      parts: [{ type: "text", text: "hi" }],
    });
  });

  it("rejects requests missing parts when envelope is not provided", () => {
    const parsed = AgentTurnRequest.safeParse({
      channel: "telegram",
      thread_id: "123",
    });

    expect(parsed.success).toBe(false);
  });
});
