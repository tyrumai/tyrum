import { describe, expect, it } from "vitest";
import {
  AgentCapabilitiesResponse,
  AgentSecretReference,
  AgentTurnRequest,
  IdentityPack,
  McpServerSpec,
  SkillManifest,
} from "../src/index.js";
import { expectRejects } from "./test-helpers.js";

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
