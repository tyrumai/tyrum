-- Persist watcher definitions for planner orchestration.
CREATE TABLE IF NOT EXISTS watchers (
    id BIGSERIAL PRIMARY KEY,
    event_source TEXT NOT NULL,
    predicate TEXT NOT NULL,
    plan_reference TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'active',
    metadata JSONB NOT NULL DEFAULT '{}'::JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CHECK (char_length(trim(event_source)) > 0),
    CHECK (char_length(trim(predicate)) > 0),
    CHECK (char_length(trim(plan_reference)) > 0),
    CHECK (char_length(event_source) <= 64),
    CHECK (char_length(predicate) <= 2048),
    CHECK (char_length(plan_reference) <= 128),
    CHECK (
        status IN ('draft', 'active', 'disabled')
    ),
    CHECK (jsonb_typeof(metadata) = 'object')
);

COMMENT ON TABLE watchers IS 'Registered watcher definitions available for planner evaluation.';
COMMENT ON COLUMN watchers.event_source IS 'Normalized trigger origin for the watcher (e.g. email, messages, calendar).';
COMMENT ON COLUMN watchers.predicate IS 'Predicate expression evaluated to determine watcher activation.';
COMMENT ON COLUMN watchers.plan_reference IS 'Planner plan identifier invoked when a watcher fires.';
COMMENT ON COLUMN watchers.status IS 'Lifecycle state for the watcher (draft, active, disabled).';
COMMENT ON COLUMN watchers.metadata IS 'JSON object containing planner-facing metadata for joins.';
COMMENT ON COLUMN watchers.created_at IS 'Timestamp when the watcher registration was created.';
COMMENT ON COLUMN watchers.updated_at IS 'Timestamp when the watcher registration was last updated.';

CREATE UNIQUE INDEX IF NOT EXISTS watchers_event_predicate_plan_unique
    ON watchers (event_source, predicate, plan_reference);
