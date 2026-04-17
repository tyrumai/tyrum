import { AgentConfig } from "@tyrum/contracts";
import { describe, expect, it } from "vitest";
import {
  buildPayload,
  createBlankForm,
  snapshotToForm,
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

  it("seeds canonical tool exposure defaults for create-mode payloads", () => {
    const form = createBlankForm();
    form.agentKey = "agent-create-defaults";

    const payload = buildPayload(form);

    expect(payload.config.mcp).toEqual(
      expect.objectContaining({
        bundle: "workspace-default",
        tier: "advanced",
        pre_turn_tools: ["memory.seed"],
      }),
    );
    expect(payload.config.tools).toEqual(
      expect.objectContaining({
        bundle: "authoring-core",
        tier: "default",
      }),
    );
  });

  it("seeds canonical tool exposure from the read model before raw config values", () => {
    const form = snapshotToForm({
      agentKey: "agent-read-model",
      config: AgentConfig.parse({
        model: { model: null },
        tools: {
          bundle: "legacy-config-bundle",
          tier: "default",
        },
      }),
      toolExposure: {
        bundle: "authoring-core",
        tier: "advanced",
      },
    });

    expect(form.toolsBundle).toBe("authoring-core");
    expect(form.toolsTier).toBe("advanced");
  });

  it("falls back to raw config bundle and tier when the read model is unavailable", () => {
    const form = snapshotToForm({
      agentKey: "agent-legacy-tools",
      config: AgentConfig.parse({
        model: { model: null },
        tools: {
          bundle: "legacy-config-bundle",
          tier: "default",
        },
      }),
    });

    expect(form.toolsBundle).toBe("legacy-config-bundle");
    expect(form.toolsTier).toBe("default");
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

  it("uses editable canonical tool exposure state when building an update payload", () => {
    const form = createBlankForm();
    form.agentKey = "agent-canonical-preserve";
    form.toolsBundle = "workspace-default";
    form.toolsTier = "advanced";

    const payload = buildPayload(form, undefined, undefined, {
      bundle: "workspace-default",
      tier: "advanced",
    });

    expect(payload.config.mcp).toEqual(
      expect.objectContaining({
        bundle: "workspace-default",
        tier: "advanced",
      }),
    );
    expect(payload.config.tools).toEqual(
      expect.objectContaining({
        bundle: "workspace-default",
        tier: "advanced",
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
