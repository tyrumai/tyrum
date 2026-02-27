-- Memory v1 canonical persistence (items + provenance + tombstones + derived indexes).
--
-- Scope: all records partitioned by agent_id.

CREATE TABLE IF NOT EXISTS memory_items (
  memory_item_id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL DEFAULT 'default',
  kind TEXT NOT NULL CHECK (kind IN ('fact', 'note', 'procedure', 'episode')),
  sensitivity TEXT NOT NULL DEFAULT 'private' CHECK (sensitivity IN ('public', 'private', 'sensitive')),

  -- Fact fields
  key TEXT,
  value_json TEXT,
  observed_at TEXT,

  -- Note/procedure fields
  title TEXT,
  body_md TEXT,

  -- Episode fields
  occurred_at TEXT,
  summary_md TEXT,

  -- Shared/optional fields
  confidence DOUBLE PRECISION CHECK (confidence IS NULL OR (confidence >= 0 AND confidence <= 1)),

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ,

  CONSTRAINT memory_items_kind_required_fields CHECK (
    (kind = 'fact' AND key IS NOT NULL AND value_json IS NOT NULL AND observed_at IS NOT NULL AND confidence IS NOT NULL)
    OR (kind = 'note' AND body_md IS NOT NULL)
    OR (kind = 'procedure' AND body_md IS NOT NULL)
    OR (kind = 'episode' AND occurred_at IS NOT NULL AND summary_md IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS memory_items_agent_created_at_idx
ON memory_items (agent_id, created_at DESC);

CREATE INDEX IF NOT EXISTS memory_items_agent_kind_created_at_idx
ON memory_items (agent_id, kind, created_at DESC);

CREATE INDEX IF NOT EXISTS memory_items_agent_key_idx
ON memory_items (agent_id, key);

CREATE TABLE IF NOT EXISTS memory_item_provenance (
  memory_item_id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL DEFAULT 'default',
  source_kind TEXT NOT NULL CHECK (source_kind IN ('user', 'operator', 'tool', 'system', 'import')),
  channel TEXT,
  thread_id TEXT,
  session_id TEXT,
  message_id TEXT,
  tool_call_id TEXT,
  refs_json TEXT NOT NULL DEFAULT '[]',
  metadata_json TEXT,
  CONSTRAINT memory_item_provenance_memory_item_id_fkey
    FOREIGN KEY (memory_item_id) REFERENCES memory_items(memory_item_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS memory_item_provenance_agent_source_kind_idx
ON memory_item_provenance (agent_id, source_kind);

CREATE INDEX IF NOT EXISTS memory_item_provenance_agent_channel_idx
ON memory_item_provenance (agent_id, channel);

CREATE INDEX IF NOT EXISTS memory_item_provenance_agent_thread_id_idx
ON memory_item_provenance (agent_id, thread_id);

CREATE INDEX IF NOT EXISTS memory_item_provenance_agent_session_id_idx
ON memory_item_provenance (agent_id, session_id);

CREATE TABLE IF NOT EXISTS memory_item_tags (
  agent_id TEXT NOT NULL DEFAULT 'default',
  memory_item_id TEXT NOT NULL,
  tag TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (agent_id, memory_item_id, tag),
  CONSTRAINT memory_item_tags_memory_item_id_fkey
    FOREIGN KEY (memory_item_id) REFERENCES memory_items(memory_item_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS memory_item_tags_agent_tag_idx
ON memory_item_tags (agent_id, tag);

CREATE INDEX IF NOT EXISTS memory_item_tags_agent_memory_item_id_idx
ON memory_item_tags (agent_id, memory_item_id);

CREATE TABLE IF NOT EXISTS memory_tombstones (
  memory_item_id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL DEFAULT 'default',
  deleted_at TEXT NOT NULL,
  deleted_by TEXT NOT NULL CHECK (deleted_by IN ('user', 'operator', 'system', 'budget', 'consolidation')),
  reason TEXT
);

CREATE INDEX IF NOT EXISTS memory_tombstones_agent_deleted_at_idx
ON memory_tombstones (agent_id, deleted_at DESC);

-- Derived index tables (placeholder): memory item → embedding link.
CREATE TABLE IF NOT EXISTS memory_item_embeddings (
  agent_id TEXT NOT NULL DEFAULT 'default',
  memory_item_id TEXT NOT NULL,
  embedding_id TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (agent_id, memory_item_id, embedding_id),
  CONSTRAINT memory_item_embeddings_memory_item_id_fkey
    FOREIGN KEY (memory_item_id) REFERENCES memory_items(memory_item_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS memory_item_embeddings_agent_created_at_idx
ON memory_item_embeddings (agent_id, created_at DESC);

CREATE INDEX IF NOT EXISTS memory_item_embeddings_agent_memory_item_id_idx
ON memory_item_embeddings (agent_id, memory_item_id);

