ALTER TABLE conversations ADD COLUMN title TEXT NOT NULL DEFAULT '';

UPDATE conversations
SET title = COALESCE(
  NULLIF(
    (
      SELECT substr(
        trim(
          CASE
            WHEN instr(candidate.line, char(10)) > 0 THEN substr(candidate.line, 1, instr(candidate.line, char(10)) - 1)
            ELSE candidate.line
          END
        ),
        1,
        120
      )
      FROM (
        SELECT replace(trim(COALESCE(json_extract(je.value, '$.content'), '')), char(13), '') AS line
        FROM json_each(CASE WHEN json_valid(conversations.turns_json) THEN conversations.turns_json ELSE '[]' END) AS je
        WHERE json_extract(je.value, '$.role') IN ('user', 'assistant')
          AND length(trim(COALESCE(json_extract(je.value, '$.content'), ''))) > 0
        ORDER BY CAST(je.key AS INTEGER) ASC
        LIMIT 1
      ) AS candidate
    ),
    ''
  ),
  NULLIF(
    (
      SELECT ct.provider_thread_id
      FROM channel_threads AS ct
      WHERE ct.tenant_id = conversations.tenant_id
        AND ct.workspace_id = conversations.workspace_id
        AND ct.channel_thread_id = conversations.channel_thread_id
      LIMIT 1
    ),
    ''
  ),
  conversation_key
);
