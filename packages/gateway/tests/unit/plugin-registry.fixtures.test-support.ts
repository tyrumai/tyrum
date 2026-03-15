import { createHash } from "node:crypto";

export type PluginManifestOptions = {
  includeContributes?: boolean;
  includePermissions?: boolean;
  includeConfigSchema?: boolean;
  configSchema?: string[];
  tools?: string[];
  commands?: string[];
  entry?: string;
};

function yamlStringList(indent: string, values: string[]): string[] {
  if (values.length === 0) {
    return [`${indent}[]`];
  }

  return values.map((value) => `${indent}- ${value}`);
}

export function pluginManifestYaml(opts?: PluginManifestOptions): string {
  const includeContributes = opts?.includeContributes ?? true;
  const includePermissions = opts?.includePermissions ?? true;
  const includeConfigSchema = opts?.includeConfigSchema ?? true;
  const tools = opts?.tools ?? ["plugin.echo.echo"];
  const commands = opts?.commands ?? ["echo"];
  const entry = opts?.entry ?? "./index.mjs";

  const lines = ["id: echo", "name: Echo", "version: 0.0.1", `entry: ${entry}`];

  if (includeContributes) {
    lines.push("contributes:");
    lines.push("  tools:");
    lines.push(...yamlStringList("    ", tools));
    lines.push("  commands:");
    lines.push(...yamlStringList("    ", commands));
    lines.push("  routes: []");
    lines.push("  mcp_servers: []");
  }

  if (includePermissions) {
    lines.push("permissions:");
    lines.push("  tools: []");
    lines.push("  network_egress: []");
    lines.push("  secrets: []");
    lines.push("  db: false");
  }

  if (includeConfigSchema) {
    const schemaLines = opts?.configSchema ?? [
      "type: object",
      "properties: {}",
      "required: []",
      "additionalProperties: false",
    ];

    lines.push("config_schema:");
    for (const line of schemaLines) {
      lines.push(`  ${line}`);
    }
  }

  lines.push("");
  return lines.join("\n");
}

export function pluginEntryModule(pluginId = "echo"): string {
  return `
export function registerPlugin() {
  return {
    tools: [
      {
        descriptor: {
          id: "plugin.${pluginId}.echo",
          description: "Echo back a string.",
          effect: "read_only",
          keywords: ["${pluginId}"],
          inputSchema: {
            type: "object",
            properties: { text: { type: "string" } },
            required: ["text"],
            additionalProperties: false
          }
        },
        execute: async (args) => {
          const text = args && typeof args === "object" && args.text ? String(args.text) : "";
          return { output: text };
        }
      }
    ],
    commands: [
      {
        name: "${pluginId}",
        execute: async (argv) => ({ output: argv.join(" ") })
      }
    ]
  };
}
`;
}

export function pluginEntryModuleMutatesRoutesAndRegistersRouter(): string {
  return `
export function registerPlugin({ manifest }) {
  if (manifest.contributes) {
    delete manifest.contributes.routes;
  }
  return {
    router: { fake: true }
  };
}
`;
}

export function pluginEntryModuleMutatesAllowlistForUndeclaredTool(): string {
  return `
export function registerPlugin({ manifest }) {
  manifest.contributes.tools.push("plugin.echo.undeclared");
  return {
    tools: [
      {
        descriptor: {
          id: "plugin.echo.undeclared",
          description: "Should remain undeclared by static manifest.",
          effect: "read_only",
          keywords: ["echo"],
          inputSchema: {
            type: "object",
            properties: { text: { type: "string" } },
            required: ["text"],
            additionalProperties: false
          }
        },
        execute: async () => ({ output: "mutated" })
      }
    ]
  };
}
`;
}

export function pluginIntegritySha256Hex(manifestRaw: string, entryRaw: string): string {
  return createHash("sha256")
    .update("manifest\0")
    .update(manifestRaw)
    .update("\0entry\0")
    .update(entryRaw)
    .digest("hex");
}

export const UNKNOWN_KEY_CONFIG_SCHEMA = [
  "type: object",
  "properties:",
  "  greeting:",
  "    type: string",
  "required: []",
];

export const ALL_OF_OBJECT_SHAPES_CONFIG_SCHEMA = [
  "allOf:",
  "  - type: object",
  "    properties:",
  "      greeting:",
  "        type: string",
  "  - type: object",
  "    properties:",
  "      target:",
  "        type: string",
  "required: []",
];

export const ALL_OF_REF_OBJECT_SHAPES_CONFIG_SCHEMA = [
  "$defs:",
  "  Config~1Greeting:",
  "    type: object",
  "    properties:",
  "      greeting:",
  "        type: string",
  "  ConfigTarget:",
  "    type: object",
  "    properties:",
  "      target:",
  "        type: string",
  "allOf:",
  '  - $ref: "#/$defs/Config~01Greeting"',
  '  - $ref: "#/$defs/ConfigTarget"',
  "required: []",
];

export const REF_WITH_NESTED_OBJECT_SCHEMA = [
  "$defs:",
  "  Config~1Greeting:",
  "    type: object",
  "    properties:",
  "      greeting:",
  "        type: string",
  "  ConfigTarget:",
  "    type: object",
  "    properties:",
  "      target:",
  "        type: string",
  "type: object",
  "properties:",
  "  nested:",
  '    $ref: "#/$defs/Config~01Greeting"',
  "allOf:",
  '  - $ref: "#/$defs/Config~01Greeting"',
  '  - $ref: "#/$defs/ConfigTarget"',
  "required: []",
];

export const REF_WITH_TYPE_OBJECT_SCHEMA = [
  "$defs:",
  "  ConfigGreeting:",
  "    type: object",
  "    properties:",
  "      greeting:",
  "        type: string",
  "type: object",
  '$ref: "#/$defs/ConfigGreeting"',
  "required: []",
];

export const REF_WITH_INLINE_PROPERTIES_SCHEMA = [
  "$defs:",
  "  ConfigGreeting:",
  "    type: object",
  "    properties:",
  "      greeting:",
  "        type: string",
  "type: object",
  "properties:",
  "  target:",
  "    type: string",
  '$ref: "#/$defs/ConfigGreeting"',
  "required: []",
];

export const PROTO_POLLUTION_CONFIG_SCHEMA = [
  "type: object",
  "properties:",
  "  greeting:",
  "    type: string",
  "  __proto__:",
  "    polluted: true",
  "required: []",
];

export const NON_OBJECT_ALL_OF_SCHEMA = ["allOf:", "  - {}"];

export const REQUIRED_GREETING_CONFIG_SCHEMA = [
  "type: object",
  "properties:",
  "  greeting:",
  "    type: string",
  "required:",
  "  - greeting",
];

export const ALLOW_ADDITIONAL_PROPERTIES_SCHEMA = [
  "type: object",
  "properties:",
  "  greeting:",
  "    type: string",
  "required: []",
  "additionalProperties: true",
];
