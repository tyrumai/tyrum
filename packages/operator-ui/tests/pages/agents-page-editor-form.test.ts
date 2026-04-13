import { describe, expect, it } from "vitest";
import {
  buildPayload,
  createBlankForm,
} from "../../src/components/pages/agents-page-editor-form.js";

describe("agents-page-editor-form", () => {
  it("rejects empty agent keys when building a create payload", () => {
    const form = createBlankForm();

    expect(() => buildPayload(form)).toThrowError("Agent key is required.");
  });

  it("persists a blank primary model as null", () => {
    const form = createBlankForm();
    form.agentKey = "agent-null-model";
    form.model = "";
    form.variant = "ignored";
    form.fallbacks = "openai/gpt-4.1";

    const payload = buildPayload(form);
    expect(payload.config.model).toEqual({ model: null });
  });

  it("preserves hidden MCP settings when building a payload", () => {
    const form = createBlankForm();
    form.agentKey = "agent-mcp-preserve";
    form.mcpDefaultMode = "deny";
    form.mcpAllow = ["filesystem"];
    form.mcpDeny = ["secrets"];
    form.memorySettingsMode = "override";

    const payload = buildPayload(form, undefined, {
      pre_turn_tools: ["mcp.memory.seed"],
      server_settings: {
        filesystem: {
          namespace: "agents",
        },
      },
    });

    expect(payload.config.mcp).toEqual(
      expect.objectContaining({
        default_mode: "deny",
        allow: ["filesystem"],
        deny: ["secrets"],
        pre_turn_tools: ["memory.seed"],
        server_settings: expect.objectContaining({
          filesystem: {
            namespace: "agents",
          },
          memory: expect.objectContaining({
            enabled: true,
          }),
        }),
      }),
    );
  });

  it("drops explicit memory server settings when inheriting shared defaults", () => {
    const form = createBlankForm();
    form.agentKey = "agent-memory-inherit";
    form.memorySettingsMode = "inherit";

    const payload = buildPayload(form, undefined, {
      pre_turn_tools: ["mcp.memory.seed"],
      server_settings: {
        filesystem: {
          namespace: "agents",
        },
        memory: {
          enabled: false,
        },
      },
    });

    expect(payload.config.mcp.server_settings).toEqual({
      filesystem: {
        namespace: "agents",
      },
    });
  });
});
