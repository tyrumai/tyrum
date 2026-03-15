type JsonSchema = Record<string, unknown>;
type ObjectProperties = Record<string, JsonSchema>;

const STRING_SCHEMA = { type: "string" } as const;
const NUMBER_SCHEMA = { type: "number" } as const;
const SUBAGENT_STATUSES = ["running", "paused", "closing", "closed", "failed"] as const;
const HELPER_EXECUTION_PROFILES = ["explorer_ro", "reviewer_ro", "jury"] as const;

function enumSchema(values: readonly string[]): JsonSchema {
  return {
    type: "string",
    enum: [...values],
  };
}

function arraySchema(items: JsonSchema): JsonSchema {
  return {
    type: "array",
    items,
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

export const SUBAGENT_TOOL_INPUT_SCHEMAS = {
  "subagent.spawn": objectSchema(
    {
      execution_profile: enumSchema(HELPER_EXECUTION_PROFILES),
      message: STRING_SCHEMA,
    },
    ["execution_profile", "message"],
  ),
  "subagent.list": objectSchema({
    statuses: arraySchema(enumSchema(SUBAGENT_STATUSES)),
    limit: NUMBER_SCHEMA,
    cursor: STRING_SCHEMA,
  }),
  "subagent.get": objectSchema({ subagent_id: STRING_SCHEMA }, ["subagent_id"]),
  "subagent.send": objectSchema(
    {
      subagent_id: STRING_SCHEMA,
      message: STRING_SCHEMA,
    },
    ["subagent_id", "message"],
  ),
  "subagent.close": objectSchema(
    {
      subagent_id: STRING_SCHEMA,
      reason: STRING_SCHEMA,
    },
    ["subagent_id"],
  ),
} as const satisfies Record<string, JsonSchema>;

export type SubagentToolId = keyof typeof SUBAGENT_TOOL_INPUT_SCHEMAS;
