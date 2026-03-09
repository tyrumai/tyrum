ALTER TABLE sessions ADD COLUMN title TEXT NOT NULL DEFAULT '';

UPDATE sessions
SET title = COALESCE(
  NULLIF(
    (
      SELECT LEFT(BTRIM(SPLIT_PART(candidate.line, E'\n', 1)), 120)
      FROM (
        SELECT REPLACE(BTRIM(COALESCE(je.value ->> 'content', '')), E'\r', '') AS line
        FROM jsonb_array_elements(
          CASE
            WHEN pg_input_is_valid(sessions.turns_json, 'jsonb') THEN sessions.turns_json::jsonb
            ELSE '[]'::jsonb
          END
        ) WITH ORDINALITY AS je(value, ord)
        WHERE je.value ->> 'role' IN ('user', 'assistant')
          AND LENGTH(BTRIM(COALESCE(je.value ->> 'content', ''))) > 0
        ORDER BY je.ord ASC
        LIMIT 1
      ) AS candidate
    ),
    ''
  ),
  NULLIF(
    (
      SELECT ct.provider_thread_id
      FROM channel_threads AS ct
      WHERE ct.tenant_id = sessions.tenant_id
        AND ct.workspace_id = sessions.workspace_id
        AND ct.channel_thread_id = sessions.channel_thread_id
      LIMIT 1
    ),
    ''
  ),
  session_key
);
