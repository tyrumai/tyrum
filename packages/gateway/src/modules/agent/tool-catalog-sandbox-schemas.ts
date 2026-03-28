type JsonSchema = Record<string, unknown>;
type ObjectProperties = Record<string, JsonSchema>;

const STRING_SCHEMA = { type: "string" } as const;

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
      reason: STRING_SCHEMA,
    },
    ["target_key"],
  ),
} as const satisfies Record<string, JsonSchema>;

export type SandboxToolId = keyof typeof SANDBOX_TOOL_INPUT_SCHEMAS;
