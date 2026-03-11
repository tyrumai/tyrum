UPDATE auth_tokens
SET display_name = substring(btrim(display_name) from 1 for 120)
WHERE btrim(display_name) <> substring(btrim(display_name) from 1 for 120);
