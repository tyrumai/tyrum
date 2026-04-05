-- tyrum:disable_foreign_keys

CREATE TABLE artifact_links__new (
  tenant_id    TEXT NOT NULL,
  artifact_id  TEXT NOT NULL,
  parent_kind  TEXT NOT NULL CHECK (
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
  ),
  parent_id    TEXT NOT NULL,
  created_at   TEXT NOT NULL,
  PRIMARY KEY (tenant_id, artifact_id, parent_kind, parent_id),
  FOREIGN KEY (tenant_id, artifact_id)
    REFERENCES artifacts(tenant_id, artifact_id) ON DELETE CASCADE
);

INSERT INTO artifact_links__new (
  tenant_id,
  artifact_id,
  parent_kind,
  parent_id,
  created_at
)
SELECT
  tenant_id,
  artifact_id,
  parent_kind,
  parent_id,
  created_at
FROM artifact_links;

DROP TABLE artifact_links;

ALTER TABLE artifact_links__new RENAME TO artifact_links;

CREATE INDEX artifact_links_parent_idx
ON artifact_links (tenant_id, parent_kind, parent_id);
