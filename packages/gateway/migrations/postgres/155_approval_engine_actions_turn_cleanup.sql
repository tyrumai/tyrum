ALTER TABLE approval_engine_actions
  RENAME COLUMN run_id TO turn_id;

ALTER TABLE approval_engine_actions
  DROP CONSTRAINT IF EXISTS approval_engine_actions_action_kind_check;

UPDATE approval_engine_actions
SET action_kind = CASE action_kind
  WHEN 'resume_run' THEN 'resume_turn'
  WHEN 'cancel_run' THEN 'cancel_turn'
  ELSE action_kind
END;

ALTER TABLE approval_engine_actions
  ADD CONSTRAINT approval_engine_actions_action_kind_check
  CHECK (action_kind IN ('resume_turn', 'cancel_turn'));
