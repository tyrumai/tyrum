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
WHERE instr(config_json, '"tool.fs.read"') > 0
   OR instr(config_json, '"tool.fs.write"') > 0
   OR instr(config_json, '"tool.exec"') > 0
   OR instr(config_json, '"tool.http.fetch"') > 0;

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
WHERE instr(context_json, '"tool.fs.read"') > 0
   OR instr(context_json, '"tool.fs.write"') > 0
   OR instr(context_json, '"tool.exec"') > 0
   OR instr(context_json, '"tool.http.fetch"') > 0;

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
WHERE instr(bundle_json, '"tool.fs.read"') > 0
   OR instr(bundle_json, '"tool.fs.write"') > 0
   OR instr(bundle_json, '"tool.exec"') > 0
   OR instr(bundle_json, '"tool.http.fetch"') > 0;
