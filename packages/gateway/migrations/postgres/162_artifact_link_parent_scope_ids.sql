ALTER TABLE artifact_links
DROP CONSTRAINT IF EXISTS artifact_links_parent_kind_check;

ALTER TABLE artifact_links
ADD CONSTRAINT artifact_links_parent_kind_check CHECK (
  parent_kind IN (
    'execution_run',
    'execution_step',
    'execution_attempt',
    'turn_item',
    'workflow_run_step',
    'dispatch_record',
    'chat_conversation',
    'chat_message'
  )
);
