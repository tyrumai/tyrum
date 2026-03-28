UPDATE conversations
SET turns_json = COALESCE(
  (
    SELECT json_group_array(
      json_object(
        'kind',
        'text',
        'id',
        lower(hex(randomblob(16))),
        'role',
        COALESCE(json_extract(turn.value, '$.role'), 'assistant'),
        'content',
        COALESCE(json_extract(turn.value, '$.content'), ''),
        'created_at',
        COALESCE(json_extract(turn.value, '$.timestamp'), conversations.created_at)
      )
    )
    FROM json_each(conversations.turns_json) AS turn
  ),
  '[]'
)
WHERE json_valid(turns_json) = 1
  AND json_type(turns_json) = 'array'
  AND EXISTS (
    SELECT 1
    FROM json_each(conversations.turns_json) AS turn
    WHERE json_extract(turn.value, '$.kind') IS NULL
  );
