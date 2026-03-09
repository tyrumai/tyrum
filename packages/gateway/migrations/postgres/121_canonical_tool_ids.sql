UPDATE policy_overrides
SET tool_id = CASE tool_id
  WHEN 'tool.fs.read' THEN 'read'
  WHEN 'tool.fs.write' THEN 'write'
  WHEN 'tool.exec' THEN 'bash'
  WHEN 'tool.http.fetch' THEN 'webfetch'
  ELSE tool_id
END
WHERE tool_id IN ('tool.fs.read', 'tool.fs.write', 'tool.exec', 'tool.http.fetch');

UPDATE agent_configs
SET config_json = replace(
  replace(
    replace(
      replace(config_json, '"tool.fs.read"', '"read"'),
      '"tool.fs.write"',
      '"write"'
    ),
    '"tool.exec"',
    '"bash"'
  ),
  '"tool.http.fetch"',
  '"webfetch"'
)
WHERE POSITION('"tool.fs.read"' IN config_json) > 0
   OR POSITION('"tool.fs.write"' IN config_json) > 0
   OR POSITION('"tool.exec"' IN config_json) > 0
   OR POSITION('"tool.http.fetch"' IN config_json) > 0;

UPDATE approvals
SET context_json = replace(
  replace(
    replace(
      replace(context_json, '"tool.fs.read"', '"read"'),
      '"tool.fs.write"',
      '"write"'
    ),
    '"tool.exec"',
    '"bash"'
  ),
  '"tool.http.fetch"',
  '"webfetch"'
)
WHERE POSITION('"tool.fs.read"' IN context_json) > 0
   OR POSITION('"tool.fs.write"' IN context_json) > 0
   OR POSITION('"tool.exec"' IN context_json) > 0
   OR POSITION('"tool.http.fetch"' IN context_json) > 0;

UPDATE policy_snapshots
SET bundle_json = replace(
  replace(
    replace(
      replace(bundle_json, '"tool.fs.read"', '"read"'),
      '"tool.fs.write"',
      '"write"'
    ),
    '"tool.exec"',
    '"bash"'
  ),
  '"tool.http.fetch"',
  '"webfetch"'
)
WHERE POSITION('"tool.fs.read"' IN bundle_json) > 0
   OR POSITION('"tool.fs.write"' IN bundle_json) > 0
   OR POSITION('"tool.exec"' IN bundle_json) > 0
   OR POSITION('"tool.http.fetch"' IN bundle_json) > 0;
