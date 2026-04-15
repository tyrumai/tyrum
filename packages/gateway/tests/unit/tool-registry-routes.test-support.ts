import {
  buildSecretClipboardToolDescriptor,
  SECRET_CLIPBOARD_TOOL_ID,
} from "../../src/modules/agent/tool-secret-definitions.js";
import { listBuiltinToolDescriptors } from "../../src/modules/agent/tools.js";

export function buildToolRegistryCatalogFixture() {
  const pluginDescriptors = [
    {
      id: "plugin.echo.say",
      description: "Echo text back to the caller.",
      effect: "read_only" as const,
      keywords: ["echo"],
      inputSchema: {
        type: "object",
        properties: { text: { type: "string" } },
      },
    },
    {
      id: "plugin.echo.invalid",
      description: "Invalid schema tool.",
      effect: "read_only" as const,
      keywords: ["echo"],
      inputSchema: {
        oneOf: [{ type: "object", properties: {} }],
      },
    },
    {
      id: "plugin.echo.optional",
      description: "Echo text back without an explicit schema.",
      effect: "read_only" as const,
      keywords: ["echo"],
    },
    {
      id: "plugin.echo.union",
      description: "Echo text or markdown back to the caller.",
      effect: "read_only" as const,
      keywords: ["echo"],
      inputSchema: {
        type: "object",
        properties: {
          kind: { type: "string", enum: ["text", "markdown"] },
          text: { type: "string" },
          markdown: { type: "string" },
        },
        required: ["kind"],
        additionalProperties: false,
        oneOf: [
          {
            properties: {
              kind: { type: "string", enum: ["text"] },
            },
            required: ["kind", "text"],
          },
          {
            properties: {
              kind: { type: "string", enum: ["markdown"] },
            },
            required: ["kind", "markdown"],
          },
        ],
      },
    },
    {
      id: "plugin.echo.blocked",
      description: "Blocked by plugin policy.",
      effect: "read_only" as const,
      keywords: ["echo"],
      inputSchema: {
        type: "object",
        properties: { text: { type: "string" } },
      },
    },
  ];
  const rawMcpDescriptor = {
    id: "mcp.exa.web_search_exa",
    description: "Search the web with Exa.",
    effect: "state_changing" as const,
    keywords: ["mcp", "exa", "search"],
    source: "mcp" as const,
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string" },
      },
    },
  };
  const secretClipboardDescriptor = buildSecretClipboardToolDescriptor([
    {
      secret_ref_id: "secret-ref-1",
      secret_alias: "echo-token",
      allowed_tool_ids: [SECRET_CLIPBOARD_TOOL_ID],
    },
  ]);
  if (!secretClipboardDescriptor) {
    throw new Error("expected secret clipboard descriptor");
  }
  const descriptors = [
    ...listBuiltinToolDescriptors(),
    ...pluginDescriptors,
    rawMcpDescriptor,
    secretClipboardDescriptor,
  ];
  const disabledByReason = new Map<string, string>([
    ["edit", "disabled_by_state_mode"],
    ["plugin.echo.invalid", "disabled_invalid_schema"],
    ["plugin.echo.optional", "disabled_by_plugin_opt_in"],
    ["plugin.echo.blocked", "disabled_by_plugin_policy"],
  ]);
  const inventory = descriptors.map((descriptor) => ({
    descriptor,
    exposureClass:
      descriptor.id === rawMcpDescriptor.id
        ? ("mcp" as const)
        : descriptor.id.startsWith("plugin.")
          ? ("plugin" as const)
          : descriptor.source === "builtin_mcp"
            ? ("builtin_mcp" as const)
            : ("builtin" as const),
    enabledByAgent: !disabledByReason.has(descriptor.id),
    enabled: !disabledByReason.has(descriptor.id),
    reason: (disabledByReason.get(descriptor.id) ?? "enabled") as
      | "enabled"
      | "disabled_by_state_mode"
      | "disabled_invalid_schema"
      | "disabled_by_plugin_opt_in"
      | "disabled_by_plugin_policy",
  }));

  return {
    disabledByReason,
    descriptors,
    inventory,
    mcpServerSpecs: [
      {
        id: "exa",
        name: "Exa",
        transport: "remote" as const,
        url: "https://mcp.exa.ai/mcp",
      },
    ],
    pluginDescriptors,
  };
}
