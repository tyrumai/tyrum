-- Foundation for Tyrum memory tables and pgvector support.
CREATE EXTENSION IF NOT EXISTS vector;

-- Canonical truths remembered about a subject (user, contact, vendor).
CREATE TABLE IF NOT EXISTS facts (
    id BIGSERIAL PRIMARY KEY,
    subject_id UUID NOT NULL,
    fact_key TEXT NOT NULL,
    fact_value JSONB NOT NULL,
    source TEXT NOT NULL,
    observed_at TIMESTAMPTZ NOT NULL,
    confidence REAL NOT NULL DEFAULT 1.0 CHECK (confidence >= 0.0 AND confidence <= 1.0),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE facts IS 'Canonical facts captured about a single subject with provenance and confidence.';
COMMENT ON COLUMN facts.subject_id IS 'Identity this fact belongs to (user, team, or contact).';
COMMENT ON COLUMN facts.fact_key IS 'Stable key describing the fact (e.g., home_address, loyalty_id).';
COMMENT ON COLUMN facts.fact_value IS 'Structured JSON representation of the fact payload.';
COMMENT ON COLUMN facts.source IS 'Source system or observation responsible for the fact.';
COMMENT ON COLUMN facts.observed_at IS 'When the fact was observed or last verified.';
COMMENT ON COLUMN facts.confidence IS 'Confidence score between 0 and 1 that the fact is still valid.';
COMMENT ON COLUMN facts.created_at IS 'When the fact record was created in Tyrum memory.';

CREATE INDEX IF NOT EXISTS facts_subject_key_idx ON facts (subject_id, fact_key);
CREATE INDEX IF NOT EXISTS facts_subject_observed_idx ON facts (subject_id, observed_at DESC);

ALTER TABLE facts ENABLE ROW LEVEL SECURITY;
CREATE POLICY facts_rls_placeholder ON facts USING (true) WITH CHECK (true);
COMMENT ON POLICY facts_rls_placeholder ON facts IS 'TODO: tighten once subject scoping and authz are wired.';

-- Event-sourced episodic history for coordination and replay.
CREATE TABLE IF NOT EXISTS episodic_events (
    id BIGSERIAL PRIMARY KEY,
    subject_id UUID NOT NULL,
    event_id UUID NOT NULL,
    occurred_at TIMESTAMPTZ NOT NULL,
    channel TEXT NOT NULL,
    event_type TEXT NOT NULL,
    payload JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE episodic_events IS 'Event-sourced episodic memory capturing attempts, messages, and outcomes.';
COMMENT ON COLUMN episodic_events.subject_id IS 'Identity this event belongs to (user, contact, shared context).';
COMMENT ON COLUMN episodic_events.event_id IS 'Stable external identifier for deduplication and replay.';
COMMENT ON COLUMN episodic_events.occurred_at IS 'Timestamp when the event occurred in the real world.';
COMMENT ON COLUMN episodic_events.channel IS 'Channel or medium (telegram, email, web, executor).';
COMMENT ON COLUMN episodic_events.event_type IS 'High-level classification of the episodic event (message, attempt, observation).';
COMMENT ON COLUMN episodic_events.payload IS 'Structured JSON payload for the event.';
COMMENT ON COLUMN episodic_events.created_at IS 'Inserted-at timestamp for the episodic record.';

CREATE UNIQUE INDEX IF NOT EXISTS episodic_events_event_id_idx ON episodic_events (event_id);
CREATE INDEX IF NOT EXISTS episodic_events_subject_occurred_idx ON episodic_events (subject_id, occurred_at DESC);

ALTER TABLE episodic_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY episodic_events_rls_placeholder ON episodic_events USING (true) WITH CHECK (true);
COMMENT ON POLICY episodic_events_rls_placeholder ON episodic_events IS 'TODO: scope episodic access per subject once authz is in place.';

-- Vector embeddings enable semantic recall over unstructured artifacts.
CREATE TABLE IF NOT EXISTS vector_embeddings (
    id BIGSERIAL PRIMARY KEY,
    subject_id UUID NOT NULL,
    embedding_id UUID NOT NULL,
    embedding vector NOT NULL,
    embedding_model TEXT NOT NULL,
    label TEXT,
    metadata JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE vector_embeddings IS 'Semantic embeddings for unstructured artifacts associated with a subject.';
COMMENT ON COLUMN vector_embeddings.subject_id IS 'Identity this embedding belongs to.';
COMMENT ON COLUMN vector_embeddings.embedding_id IS 'External identifier for the source artifact.';
COMMENT ON COLUMN vector_embeddings.embedding IS 'Vector representation stored via pgvector.';
COMMENT ON COLUMN vector_embeddings.embedding_model IS 'Embedding model or configuration used to produce the vector.';
COMMENT ON COLUMN vector_embeddings.label IS 'Optional human-friendly label or context for the embedding.';
COMMENT ON COLUMN vector_embeddings.metadata IS 'Auxiliary JSON metadata (chunk location, tokens, etc.).';
COMMENT ON COLUMN vector_embeddings.created_at IS 'Inserted-at timestamp for the embedding.';

CREATE UNIQUE INDEX IF NOT EXISTS vector_embeddings_subject_embedding_idx ON vector_embeddings (subject_id, embedding_id);
CREATE INDEX IF NOT EXISTS vector_embeddings_subject_created_idx ON vector_embeddings (subject_id, created_at DESC);

ALTER TABLE vector_embeddings ENABLE ROW LEVEL SECURITY;
CREATE POLICY vector_embeddings_rls_placeholder ON vector_embeddings USING (true) WITH CHECK (true);
COMMENT ON POLICY vector_embeddings_rls_placeholder ON vector_embeddings IS 'TODO: restrict embedding access per subject once authz is defined.';
