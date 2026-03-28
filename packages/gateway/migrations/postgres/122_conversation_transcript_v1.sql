UPDATE conversations
SET turns_json = COALESCE(
  (
    SELECT jsonb_agg(
      jsonb_build_object(
        'kind',
        'text',
        'id',
        md5(random()::text || clock_timestamp()::text || item::text),
        'role',
        COALESCE(item->>'role', 'assistant'),
        'content',
        COALESCE(item->>'content', ''),
        'created_at',
        COALESCE(item->>'timestamp', conversations.created_at::text)
      )
    )::text
    FROM jsonb_array_elements(conversations.turns_json::jsonb) AS item
  ),
  '[]'
)
WHERE turns_json IS NOT NULL
  AND turns_json LIKE '[%'
  AND EXISTS (
    SELECT 1
    FROM jsonb_array_elements(conversations.turns_json::jsonb) AS item
    WHERE item ? 'role'
      AND NOT (item ? 'kind')
  );
