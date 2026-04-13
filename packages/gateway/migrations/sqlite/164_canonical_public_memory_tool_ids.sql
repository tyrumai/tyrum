UPDATE policy_overrides
SET tool_id = CASE tool_id
  WHEN 'mcp.memory.seed' THEN 'memory.seed'
  WHEN 'mcp.memory.search' THEN 'memory.search'
  WHEN 'mcp.memory.write' THEN 'memory.write'
  ELSE tool_id
END
WHERE tool_id IN ('mcp.memory.seed', 'mcp.memory.search', 'mcp.memory.write');

UPDATE agent_configs
SET config_json = replace(
  replace(
    replace(config_json, '"mcp.memory.seed"', '"memory.seed"'),
    '"mcp.memory.search"',
    '"memory.search"'
  ),
  '"mcp.memory.write"',
  '"memory.write"'
)
WHERE instr(config_json, '"mcp.memory.seed"') > 0
   OR instr(config_json, '"mcp.memory.search"') > 0
   OR instr(config_json, '"mcp.memory.write"') > 0;

UPDATE approvals
SET context_json = replace(
  replace(
    replace(context_json, '"mcp.memory.seed"', '"memory.seed"'),
    '"mcp.memory.search"',
    '"memory.search"'
  ),
  '"mcp.memory.write"',
  '"memory.write"'
)
WHERE instr(context_json, '"mcp.memory.seed"') > 0
   OR instr(context_json, '"mcp.memory.search"') > 0
   OR instr(context_json, '"mcp.memory.write"') > 0;

UPDATE policy_bundle_config_revisions
SET bundle_json = replace(
  replace(
    replace(bundle_json, '"mcp.memory.seed"', '"memory.seed"'),
    '"mcp.memory.search"',
    '"memory.search"'
  ),
  '"mcp.memory.write"',
  '"memory.write"'
)
WHERE instr(bundle_json, '"mcp.memory.seed"') > 0
   OR instr(bundle_json, '"mcp.memory.search"') > 0
   OR instr(bundle_json, '"mcp.memory.write"') > 0;

UPDATE policy_snapshots
SET bundle_json = replace(
  replace(
    replace(bundle_json, '"mcp.memory.seed"', '"memory.seed"'),
    '"mcp.memory.search"',
    '"memory.search"'
  ),
  '"mcp.memory.write"',
  '"memory.write"'
)
WHERE instr(bundle_json, '"mcp.memory.seed"') > 0
   OR instr(bundle_json, '"mcp.memory.search"') > 0
   OR instr(bundle_json, '"mcp.memory.write"') > 0;
