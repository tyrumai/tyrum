CREATE UNIQUE INDEX conversations_tenant_conversation_id_uq
  ON conversations (tenant_id, conversation_id);

CREATE UNIQUE INDEX turns_tenant_turn_id_uq
  ON turns (tenant_id, turn_id);

CREATE TABLE conversation_state (
  tenant_id        UUID NOT NULL,
  conversation_id  UUID NOT NULL,
  summary_json     JSONB NOT NULL DEFAULT 'null'::jsonb,
  pending_json     JSONB NOT NULL DEFAULT '{"compacted_through_message_id":null,"recent_message_ids":[],"pending_approvals":[],"pending_tool_state":[]}'::jsonb,
  updated_at       TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (tenant_id, conversation_id),
  CONSTRAINT conversation_state_conversation_fk
    FOREIGN KEY (tenant_id, conversation_id)
    REFERENCES conversations(tenant_id, conversation_id) ON DELETE CASCADE
);

INSERT INTO conversation_state (
  tenant_id,
  conversation_id,
  summary_json,
  pending_json,
  updated_at
)
SELECT
  tenant_id,
  conversation_id,
  COALESCE(context_state_json -> 'checkpoint', 'null'::jsonb) AS summary_json,
  jsonb_build_object(
    'compacted_through_message_id', context_state_json -> 'compacted_through_message_id',
    'recent_message_ids', COALESCE(context_state_json -> 'recent_message_ids', '[]'::jsonb),
    'pending_approvals', COALESCE(context_state_json -> 'pending_approvals', '[]'::jsonb),
    'pending_tool_state', COALESCE(context_state_json -> 'pending_tool_state', '[]'::jsonb)
  ) AS pending_json,
  COALESCE(NULLIF(context_state_json ->> 'updated_at', '')::timestamptz, updated_at) AS updated_at
FROM conversations;

CREATE TABLE transcript_events (
  tenant_id            UUID NOT NULL,
  transcript_event_id  TEXT NOT NULL,
  conversation_id      UUID NOT NULL,
  event_index          INTEGER NOT NULL CHECK (event_index >= 0),
  event_kind           TEXT NOT NULL CHECK (event_kind IN ('message')),
  message_id           TEXT NOT NULL,
  role                 TEXT NOT NULL,
  message_json         TEXT NOT NULL,
  created_at           TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (tenant_id, transcript_event_id),
  UNIQUE (tenant_id, conversation_id, event_index),
  CONSTRAINT transcript_events_conversation_fk
    FOREIGN KEY (tenant_id, conversation_id)
    REFERENCES conversations(tenant_id, conversation_id) ON DELETE CASCADE
);

INSERT INTO transcript_events (
  tenant_id,
  transcript_event_id,
  conversation_id,
  event_index,
  event_kind,
  message_id,
  role,
  message_json,
  created_at
)
SELECT
  c.tenant_id,
  c.conversation_id::text || ':' || COALESCE(NULLIF(event.value ->> 'id', ''), 'message-' || (event.ordinality - 1)::text)
    AS transcript_event_id,
  c.conversation_id,
  (event.ordinality - 1)::integer AS event_index,
  'message' AS event_kind,
  COALESCE(NULLIF(event.value ->> 'id', ''), 'message-' || (event.ordinality - 1)::text) AS message_id,
  COALESCE(NULLIF(event.value ->> 'role', ''), 'assistant') AS role,
  event.value::text AS message_json,
  COALESCE(
    NULLIF(event.value #>> '{metadata,created_at}', '')::timestamptz,
    NULLIF(event.value #>> '{metadata,createdAt}', '')::timestamptz,
    NULLIF(event.value #>> '{metadata,timestamp}', '')::timestamptz,
    c.updated_at
  ) AS created_at
FROM conversations c
CROSS JOIN LATERAL jsonb_array_elements(
  CASE
    WHEN c.messages_json IS NOT NULL
      AND btrim(c.messages_json) <> ''
      AND pg_input_is_valid(c.messages_json, 'jsonb')
      AND jsonb_typeof(c.messages_json::jsonb) = 'array'
      THEN c.messages_json::jsonb
    ELSE '[]'::jsonb
  END
) WITH ORDINALITY AS event(value, ordinality);

ALTER TABLE conversations DROP COLUMN messages_json;
ALTER TABLE conversations DROP COLUMN context_state_json;

CREATE INDEX transcript_events_conversation_idx
  ON transcript_events (tenant_id, conversation_id, created_at ASC, event_index ASC);
