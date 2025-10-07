-- Capability memories capture selectors and outcomes for successful executor runs.
CREATE TABLE IF NOT EXISTS capability_memories (
    id BIGSERIAL PRIMARY KEY,
    subject_id UUID NOT NULL,
    capability_type TEXT NOT NULL,
    capability_identifier TEXT NOT NULL,
    executor_kind TEXT NOT NULL,
    selectors JSONB,
    outcome_metadata JSONB NOT NULL,
    result_summary TEXT,
    success_count INTEGER NOT NULL DEFAULT 1 CHECK (success_count > 0),
    last_success_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE capability_memories IS 'Successful executor flows (selectors, postconditions, costs) for the subject + capability combination.';
COMMENT ON COLUMN capability_memories.subject_id IS 'Identity this capability memory belongs to.';
COMMENT ON COLUMN capability_memories.capability_type IS 'High-level capability classification (web, http, android, structured_api).';
COMMENT ON COLUMN capability_memories.capability_identifier IS 'Vendor or endpoint identifier to scope executor reuse (e.g., domain, API slug).';
COMMENT ON COLUMN capability_memories.executor_kind IS 'Executor responsible for the successful run.';
COMMENT ON COLUMN capability_memories.selectors IS 'Selector hints and flow parameters that may contain PII and must be redacted before sharing outside trusted services.';
COMMENT ON COLUMN capability_memories.outcome_metadata IS 'Structured JSON describing the successful outcome (postconditions, artifacts, costs).';
COMMENT ON COLUMN capability_memories.result_summary IS 'Human-readable description for debugging and manual audits.';

CREATE UNIQUE INDEX IF NOT EXISTS capability_memories_unique_flow_idx
    ON capability_memories (subject_id, capability_type, capability_identifier, executor_kind);
CREATE INDEX IF NOT EXISTS capability_memories_subject_type_idx
    ON capability_memories (subject_id, capability_type);
CREATE INDEX IF NOT EXISTS capability_memories_last_success_idx
    ON capability_memories (subject_id, last_success_at DESC);

ALTER TABLE capability_memories ENABLE ROW LEVEL SECURITY;
CREATE POLICY capability_memories_rls_placeholder ON capability_memories USING (true) WITH CHECK (true);
COMMENT ON POLICY capability_memories_rls_placeholder ON capability_memories IS 'TODO: scope capability memories by subject once authz is in place.';
