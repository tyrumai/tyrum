UPDATE auth_tokens
SET display_name = substr(trim(display_name), 1, 120)
WHERE trim(display_name) <> substr(trim(display_name), 1, 120);
