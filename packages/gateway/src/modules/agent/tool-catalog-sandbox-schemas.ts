type JsonSchema = Record<string, unknown>;
type ObjectProperties = Record<string, JsonSchema>;

const STRING_SCHEMA = { type: "string" } as const;
const INTERNAL_LANES = ["main", "cron", "heartbeat", "subagent"] as const;

function enumSchema(values: readonly string[]): JsonSchema {
  return {
    type: "string",
    enum: [...values],
  };
}

function objectSchema(properties: ObjectProperties, required: readonly string[] = []): JsonSchema {
  return {
    type: "object",
    properties,
    ...(required.length > 0 ? { required: [...required] } : {}),
    additionalProperties: false,
  };
}

export const SANDBOX_TOOL_INPUT_SCHEMAS = {
  "sandbox.current": objectSchema({}),
  "sandbox.request": objectSchema({
    label: STRING_SCHEMA,
  }),
  "sandbox.release": objectSchema({}),
  "sandbox.handoff": objectSchema(
    {
      target_key: STRING_SCHEMA,
      target_lane: enumSchema(INTERNAL_LANES),
      reason: STRING_SCHEMA,
    },
    ["target_key", "target_lane"],
  ),
} as const satisfies Record<string, JsonSchema>;

export type SandboxToolId = keyof typeof SANDBOX_TOOL_INPUT_SCHEMAS;
