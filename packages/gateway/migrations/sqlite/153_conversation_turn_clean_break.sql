ALTER TABLE sessions RENAME TO conversations;
ALTER TABLE conversations RENAME COLUMN session_id TO conversation_id;
ALTER TABLE conversations RENAME COLUMN session_key TO conversation_key;

ALTER TABLE session_model_overrides RENAME TO conversation_model_overrides;
ALTER TABLE conversation_model_overrides RENAME COLUMN session_id TO conversation_id;

ALTER TABLE session_provider_pins RENAME TO conversation_provider_pins;
ALTER TABLE conversation_provider_pins RENAME COLUMN session_id TO conversation_id;

ALTER TABLE session_send_policy_overrides RENAME TO conversation_send_policy_overrides;
ALTER TABLE conversation_send_policy_overrides RENAME COLUMN key TO conversation_key;

ALTER TABLE lane_queue_mode_overrides RENAME TO conversation_queue_overrides;
ALTER TABLE conversation_queue_overrides RENAME COLUMN key TO conversation_key;

ALTER TABLE lane_queue_signals RENAME TO conversation_queue_signals;
ALTER TABLE conversation_queue_signals RENAME COLUMN key TO conversation_key;

ALTER TABLE lane_leases RENAME TO conversation_leases;
ALTER TABLE conversation_leases RENAME COLUMN key TO conversation_key;

ALTER TABLE turn_jobs RENAME COLUMN session_id TO conversation_id;
ALTER TABLE turn_jobs RENAME COLUMN key TO conversation_key;
ALTER TABLE turn_jobs RENAME COLUMN latest_run_id TO latest_turn_id;

ALTER TABLE turns RENAME COLUMN key TO conversation_key;
ALTER TABLE turns RENAME COLUMN paused_reason TO blocked_reason;
ALTER TABLE turns RENAME COLUMN paused_detail TO blocked_detail;

ALTER TABLE approvals RENAME COLUMN session_id TO conversation_id;

ALTER TABLE context_reports RENAME COLUMN session_id TO conversation_id;

CREATE UNIQUE INDEX conversations_tenant_conversation_id_uq
  ON conversations (tenant_id, conversation_id);

CREATE UNIQUE INDEX turns_tenant_turn_id_uq
  ON turns (tenant_id, turn_id);

CREATE TABLE conversation_state (
  tenant_id        TEXT NOT NULL,
  conversation_id  TEXT NOT NULL,
  summary_json     TEXT NOT NULL DEFAULT 'null',
  pending_json     TEXT NOT NULL DEFAULT '{"compacted_through_message_id":null,"recent_message_ids":[],"pending_approvals":[],"pending_tool_state":[]}',
  updated_at       TEXT NOT NULL,
  PRIMARY KEY (tenant_id, conversation_id),
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
  CASE
    WHEN json_valid(context_state_json)
      THEN COALESCE(json_extract(context_state_json, '$.checkpoint'), 'null')
    ELSE 'null'
  END AS summary_json,
  CASE
    WHEN json_valid(context_state_json)
      THEN json_object(
        'compacted_through_message_id', json_extract(context_state_json, '$.compacted_through_message_id'),
        'recent_message_ids', json(COALESCE(json_extract(context_state_json, '$.recent_message_ids'), '[]')),
        'pending_approvals', json(COALESCE(json_extract(context_state_json, '$.pending_approvals'), '[]')),
        'pending_tool_state', json(COALESCE(json_extract(context_state_json, '$.pending_tool_state'), '[]'))
      )
    ELSE '{"compacted_through_message_id":null,"recent_message_ids":[],"pending_approvals":[],"pending_tool_state":[]}'
  END AS pending_json,
  COALESCE(
    CASE
      WHEN json_valid(context_state_json)
        THEN NULLIF(json_extract(context_state_json, '$.updated_at'), '')
      ELSE NULL
    END,
    updated_at
  ) AS updated_at
FROM conversations;

CREATE TABLE transcript_events (
  tenant_id            TEXT NOT NULL,
  transcript_event_id  TEXT NOT NULL,
  conversation_id      TEXT NOT NULL,
  event_index          INTEGER NOT NULL CHECK (event_index >= 0),
  event_kind           TEXT NOT NULL CHECK (event_kind IN ('message')),
  message_id           TEXT NOT NULL,
  role                 TEXT NOT NULL,
  message_json         TEXT NOT NULL,
  created_at           TEXT NOT NULL,
  PRIMARY KEY (tenant_id, transcript_event_id),
  UNIQUE (tenant_id, conversation_id, event_index),
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
  c.conversation_id || ':' || COALESCE(
    NULLIF(json_extract(event.value, '$.id'), ''),
    'message-' || CAST(CAST(event.key AS INTEGER) AS TEXT)
  ) AS transcript_event_id,
  c.conversation_id,
  CAST(event.key AS INTEGER) AS event_index,
  'message' AS event_kind,
  COALESCE(
    NULLIF(json_extract(event.value, '$.id'), ''),
    'message-' || CAST(CAST(event.key AS INTEGER) AS TEXT)
  ) AS message_id,
  COALESCE(NULLIF(json_extract(event.value, '$.role'), ''), 'assistant') AS role,
  event.value AS message_json,
  COALESCE(
    NULLIF(json_extract(event.value, '$.metadata.created_at'), ''),
    NULLIF(json_extract(event.value, '$.metadata.createdAt'), ''),
    NULLIF(json_extract(event.value, '$.metadata.timestamp'), ''),
    c.updated_at
  ) AS created_at
FROM conversations c
JOIN json_each(CASE WHEN json_valid(c.messages_json) THEN c.messages_json ELSE '[]' END) AS event;

ALTER TABLE conversations DROP COLUMN messages_json;
ALTER TABLE conversations DROP COLUMN context_state_json;

CREATE INDEX transcript_events_conversation_idx
  ON transcript_events (tenant_id, conversation_id, created_at ASC, event_index ASC);
