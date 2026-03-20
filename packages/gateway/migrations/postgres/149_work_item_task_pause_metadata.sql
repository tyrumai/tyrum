ALTER TABLE work_item_tasks
  ADD COLUMN subagent_id UUID,
  ADD COLUMN pause_reason TEXT,
  ADD COLUMN pause_detail TEXT;
