-- planner event log stores append-only action traces with stable replay identifiers.
CREATE TABLE IF NOT EXISTS planner_events (
    id BIGSERIAL PRIMARY KEY,
    replay_id UUID NOT NULL,
    plan_id UUID NOT NULL,
    step_index INTEGER NOT NULL CHECK (step_index >= 0),
    occurred_at TIMESTAMPTZ NOT NULL,
    action JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE planner_events IS 'Append-only audit log of planner actions.';
COMMENT ON COLUMN planner_events.replay_id IS 'Stable identifier supplied by the planner to support deterministic replays.';
COMMENT ON COLUMN planner_events.plan_id IS 'Identifier for the plan this action belongs to.';
COMMENT ON COLUMN planner_events.step_index IS 'Plan-relative ordering of the action (zero-based).';
COMMENT ON COLUMN planner_events.action IS 'Serialized action payload with parameters and context.';
COMMENT ON COLUMN planner_events.occurred_at IS 'Timestamp emitted by the planner when the action was taken.';

CREATE UNIQUE INDEX IF NOT EXISTS planner_events_replay_id_idx ON planner_events (replay_id);
CREATE UNIQUE INDEX IF NOT EXISTS planner_events_plan_step_idx ON planner_events (plan_id, step_index);
CREATE INDEX IF NOT EXISTS planner_events_plan_created_idx ON planner_events (plan_id, created_at);
