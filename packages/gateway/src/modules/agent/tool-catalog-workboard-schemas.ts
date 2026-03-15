type JsonSchema = Record<string, unknown>;
type ObjectProperties = Record<string, JsonSchema>;

const STRING_SCHEMA = { type: "string" } as const;
const NUMBER_SCHEMA = { type: "number" } as const;
const ANY_JSON_VALUE_SCHEMA = {
  description: "Any JSON value.",
} as const satisfies JsonSchema;

const WORK_ITEM_STATES = [
  "backlog",
  "ready",
  "doing",
  "blocked",
  "done",
  "failed",
  "cancelled",
] as const;
const WORK_ITEM_TRANSITION_STATES = [
  "backlog",
  "ready",
  "blocked",
  "done",
  "failed",
  "cancelled",
] as const;
const WORK_ITEM_KINDS = ["action", "initiative"] as const;
const TASK_STATES = [
  "queued",
  "leased",
  "running",
  "paused",
  "completed",
  "failed",
  "cancelled",
  "skipped",
] as const;
const ARTIFACT_KINDS = [
  "candidate_plan",
  "hypothesis",
  "risk",
  "tool_intent",
  "verification_report",
  "jury_opinion",
  "result_summary",
  "other",
] as const;
const SIGNAL_STATUSES = ["active", "paused", "fired", "resolved", "cancelled"] as const;
const SIGNAL_TRIGGER_KINDS = ["time", "event"] as const;
const CLARIFICATION_STATUSES = ["open", "answered", "cancelled"] as const;
const STATE_SCOPE_KINDS = ["agent", "work_item"] as const;

const CURSOR_LIMIT_PROPERTIES = {
  limit: NUMBER_SCHEMA,
  cursor: STRING_SCHEMA,
} as const satisfies ObjectProperties;

const STATE_SCOPE_PROPERTIES = {
  scope_kind: {
    type: "string",
    enum: [...STATE_SCOPE_KINDS],
    description: "Use work_item when targeting a specific work item.",
  },
  work_item_id: {
    type: "string",
    description: "Required when scope_kind is work_item.",
  },
} as const satisfies ObjectProperties;

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

export const WORKBOARD_TOOL_INPUT_SCHEMAS = {
  "workboard.capture": objectSchema({
    kind: enumSchema(WORK_ITEM_KINDS),
    title: STRING_SCHEMA,
    priority: NUMBER_SCHEMA,
    acceptance: ANY_JSON_VALUE_SCHEMA,
    request: STRING_SCHEMA,
    parent_work_item_id: STRING_SCHEMA,
  }),
  "workboard.item.list": objectSchema({
    statuses: arraySchema(enumSchema(WORK_ITEM_STATES)),
    kinds: arraySchema(enumSchema(WORK_ITEM_KINDS)),
    ...CURSOR_LIMIT_PROPERTIES,
  }),
  "workboard.item.get": objectSchema({ work_item_id: STRING_SCHEMA }, ["work_item_id"]),
  "workboard.item.create": objectSchema({
    kind: enumSchema(WORK_ITEM_KINDS),
    title: STRING_SCHEMA,
    priority: NUMBER_SCHEMA,
    acceptance: ANY_JSON_VALUE_SCHEMA,
    parent_work_item_id: STRING_SCHEMA,
  }),
  "workboard.item.delete": objectSchema({ work_item_id: STRING_SCHEMA }, ["work_item_id"]),
  "workboard.item.update": objectSchema(
    {
      work_item_id: STRING_SCHEMA,
      title: STRING_SCHEMA,
      priority: NUMBER_SCHEMA,
      acceptance: ANY_JSON_VALUE_SCHEMA,
    },
    ["work_item_id"],
  ),
  "workboard.item.transition": objectSchema(
    {
      work_item_id: STRING_SCHEMA,
      status: enumSchema(WORK_ITEM_TRANSITION_STATES),
      reason: STRING_SCHEMA,
    },
    ["work_item_id", "status"],
  ),
  "workboard.task.list": objectSchema({ work_item_id: STRING_SCHEMA }, ["work_item_id"]),
  "workboard.task.get": objectSchema({ task_id: STRING_SCHEMA }, ["task_id"]),
  "workboard.task.create": objectSchema(
    {
      work_item_id: STRING_SCHEMA,
      status: enumSchema(TASK_STATES),
      depends_on: arraySchema(STRING_SCHEMA),
      execution_profile: STRING_SCHEMA,
      side_effect_class: STRING_SCHEMA,
      result_summary: STRING_SCHEMA,
    },
    ["work_item_id"],
  ),
  "workboard.task.delete": objectSchema({ task_id: STRING_SCHEMA }, ["task_id"]),
  "workboard.task.update": objectSchema(
    {
      task_id: STRING_SCHEMA,
      status: enumSchema(TASK_STATES),
      result_summary: STRING_SCHEMA,
    },
    ["task_id"],
  ),
  "workboard.artifact.list": objectSchema({
    work_item_id: STRING_SCHEMA,
    ...CURSOR_LIMIT_PROPERTIES,
  }),
  "workboard.artifact.get": objectSchema({ artifact_id: STRING_SCHEMA }, ["artifact_id"]),
  "workboard.artifact.create": objectSchema({
    work_item_id: STRING_SCHEMA,
    kind: enumSchema(ARTIFACT_KINDS),
    title: STRING_SCHEMA,
    body_md: STRING_SCHEMA,
    refs: arraySchema(STRING_SCHEMA),
  }),
  "workboard.artifact.delete": objectSchema({ artifact_id: STRING_SCHEMA }, ["artifact_id"]),
  "workboard.decision.list": objectSchema({
    work_item_id: STRING_SCHEMA,
    ...CURSOR_LIMIT_PROPERTIES,
  }),
  "workboard.decision.get": objectSchema({ decision_id: STRING_SCHEMA }, ["decision_id"]),
  "workboard.decision.create": objectSchema(
    {
      work_item_id: STRING_SCHEMA,
      question: STRING_SCHEMA,
      chosen: STRING_SCHEMA,
      rationale_md: STRING_SCHEMA,
      alternatives: arraySchema(STRING_SCHEMA),
      input_artifact_ids: arraySchema(STRING_SCHEMA),
    },
    ["chosen", "rationale_md"],
  ),
  "workboard.decision.delete": objectSchema({ decision_id: STRING_SCHEMA }, ["decision_id"]),
  "workboard.signal.list": objectSchema({
    work_item_id: STRING_SCHEMA,
    statuses: arraySchema(enumSchema(SIGNAL_STATUSES)),
    ...CURSOR_LIMIT_PROPERTIES,
  }),
  "workboard.signal.get": objectSchema({ signal_id: STRING_SCHEMA }, ["signal_id"]),
  "workboard.signal.create": objectSchema({
    work_item_id: STRING_SCHEMA,
    trigger_kind: enumSchema(SIGNAL_TRIGGER_KINDS),
    trigger_spec_json: ANY_JSON_VALUE_SCHEMA,
    payload_json: ANY_JSON_VALUE_SCHEMA,
    status: enumSchema(SIGNAL_STATUSES),
  }),
  "workboard.signal.delete": objectSchema({ signal_id: STRING_SCHEMA }, ["signal_id"]),
  "workboard.signal.update": objectSchema(
    {
      signal_id: STRING_SCHEMA,
      trigger_spec_json: ANY_JSON_VALUE_SCHEMA,
      payload_json: ANY_JSON_VALUE_SCHEMA,
      status: enumSchema(SIGNAL_STATUSES),
    },
    ["signal_id"],
  ),
  "workboard.state.list": objectSchema({
    ...STATE_SCOPE_PROPERTIES,
    prefix: STRING_SCHEMA,
  }),
  "workboard.state.get": objectSchema(
    {
      ...STATE_SCOPE_PROPERTIES,
      key: STRING_SCHEMA,
    },
    ["key"],
  ),
  "workboard.state.delete": objectSchema(
    {
      ...STATE_SCOPE_PROPERTIES,
      key: STRING_SCHEMA,
    },
    ["key"],
  ),
  "workboard.state.set": objectSchema(
    {
      ...STATE_SCOPE_PROPERTIES,
      key: STRING_SCHEMA,
      value_json: ANY_JSON_VALUE_SCHEMA,
      provenance_json: ANY_JSON_VALUE_SCHEMA,
    },
    ["key"],
  ),
  "workboard.clarification.list": objectSchema({
    work_item_id: STRING_SCHEMA,
    statuses: arraySchema(enumSchema(CLARIFICATION_STATUSES)),
    ...CURSOR_LIMIT_PROPERTIES,
  }),
  "workboard.clarification.request": objectSchema(
    {
      work_item_id: STRING_SCHEMA,
      question: STRING_SCHEMA,
    },
    ["work_item_id", "question"],
  ),
  "workboard.clarification.answer": objectSchema(
    {
      clarification_id: STRING_SCHEMA,
      answer_text: STRING_SCHEMA,
    },
    ["clarification_id", "answer_text"],
  ),
  "workboard.clarification.cancel": objectSchema({ clarification_id: STRING_SCHEMA }, [
    "clarification_id",
  ]),
} as const satisfies Record<string, JsonSchema>;

export type WorkboardToolId = keyof typeof WORKBOARD_TOOL_INPUT_SCHEMAS;
