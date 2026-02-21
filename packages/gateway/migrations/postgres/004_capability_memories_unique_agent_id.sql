-- capability_memories should be isolated per agent.

ALTER TABLE capability_memories
  DROP CONSTRAINT IF EXISTS capability_memories_unique;

ALTER TABLE capability_memories
  ADD CONSTRAINT capability_memories_unique UNIQUE (
    capability_type,
    capability_identifier,
    executor_kind,
    agent_id
  );

