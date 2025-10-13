ALTER TABLE capability_memories
    ADD COLUMN cost_profile JSONB NOT NULL DEFAULT '{}'::jsonb,
    ADD COLUMN anti_bot_notes JSONB NOT NULL DEFAULT '[]'::jsonb;

COMMENT ON COLUMN capability_memories.cost_profile IS 'Cached vendor pricing details such as rate cards, currencies, and observed timestamps.';
COMMENT ON COLUMN capability_memories.anti_bot_notes IS 'Executor-facing notes about anti-bot mitigations, captchas, or throttling workarounds.';

COMMENT ON TABLE capability_memories IS 'Successful executor flows (selectors, postconditions, costs, anti-bot strategies) for the subject + capability combination.';
