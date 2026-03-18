-- Remove tyrum.cli.execute and tyrum.http.request from persisted capability arrays.
-- These capabilities are no longer valid node capabilities (removed from ClientCapability).
-- Uses JSON array manipulation to cleanly remove entries.

-- node_pairings.capabilities_json
UPDATE node_pairings SET capabilities_json = REPLACE(capabilities_json, '"tyrum.cli.execute",', '') WHERE capabilities_json LIKE '%tyrum.cli.execute%';
UPDATE node_pairings SET capabilities_json = REPLACE(capabilities_json, ',"tyrum.cli.execute"', '') WHERE capabilities_json LIKE '%tyrum.cli.execute%';
UPDATE node_pairings SET capabilities_json = REPLACE(capabilities_json, '"tyrum.cli.execute"', '') WHERE capabilities_json LIKE '%tyrum.cli.execute%';

-- node_pairings.capability_allowlist_json
UPDATE node_pairings SET capability_allowlist_json = REPLACE(capability_allowlist_json, '"tyrum.cli.execute",', '') WHERE capability_allowlist_json LIKE '%tyrum.cli.execute%';
UPDATE node_pairings SET capability_allowlist_json = REPLACE(capability_allowlist_json, ',"tyrum.cli.execute"', '') WHERE capability_allowlist_json LIKE '%tyrum.cli.execute%';
UPDATE node_pairings SET capability_allowlist_json = REPLACE(capability_allowlist_json, '"tyrum.cli.execute"', '') WHERE capability_allowlist_json LIKE '%tyrum.cli.execute%';

-- connections.capabilities_json
UPDATE connections SET capabilities_json = REPLACE(capabilities_json, '"tyrum.cli.execute",', '') WHERE capabilities_json LIKE '%tyrum.cli.execute%';
UPDATE connections SET capabilities_json = REPLACE(capabilities_json, ',"tyrum.cli.execute"', '') WHERE capabilities_json LIKE '%tyrum.cli.execute%';
UPDATE connections SET capabilities_json = REPLACE(capabilities_json, '"tyrum.cli.execute"', '') WHERE capabilities_json LIKE '%tyrum.cli.execute%';

-- connections.ready_capabilities_json
UPDATE connections SET ready_capabilities_json = REPLACE(ready_capabilities_json, '"tyrum.cli.execute",', '') WHERE ready_capabilities_json LIKE '%tyrum.cli.execute%';
UPDATE connections SET ready_capabilities_json = REPLACE(ready_capabilities_json, ',"tyrum.cli.execute"', '') WHERE ready_capabilities_json LIKE '%tyrum.cli.execute%';
UPDATE connections SET ready_capabilities_json = REPLACE(ready_capabilities_json, '"tyrum.cli.execute"', '') WHERE ready_capabilities_json LIKE '%tyrum.cli.execute%';

-- connections.capability_states_json
UPDATE connections SET capability_states_json = REPLACE(capability_states_json, '"tyrum.cli.execute",', '') WHERE capability_states_json LIKE '%tyrum.cli.execute%';
UPDATE connections SET capability_states_json = REPLACE(capability_states_json, ',"tyrum.cli.execute"', '') WHERE capability_states_json LIKE '%tyrum.cli.execute%';
UPDATE connections SET capability_states_json = REPLACE(capability_states_json, '"tyrum.cli.execute"', '') WHERE capability_states_json LIKE '%tyrum.cli.execute%';

-- Repeat for tyrum.http.request

-- node_pairings.capabilities_json
UPDATE node_pairings SET capabilities_json = REPLACE(capabilities_json, '"tyrum.http.request",', '') WHERE capabilities_json LIKE '%tyrum.http.request%';
UPDATE node_pairings SET capabilities_json = REPLACE(capabilities_json, ',"tyrum.http.request"', '') WHERE capabilities_json LIKE '%tyrum.http.request%';
UPDATE node_pairings SET capabilities_json = REPLACE(capabilities_json, '"tyrum.http.request"', '') WHERE capabilities_json LIKE '%tyrum.http.request%';

-- node_pairings.capability_allowlist_json
UPDATE node_pairings SET capability_allowlist_json = REPLACE(capability_allowlist_json, '"tyrum.http.request",', '') WHERE capability_allowlist_json LIKE '%tyrum.http.request%';
UPDATE node_pairings SET capability_allowlist_json = REPLACE(capability_allowlist_json, ',"tyrum.http.request"', '') WHERE capability_allowlist_json LIKE '%tyrum.http.request%';
UPDATE node_pairings SET capability_allowlist_json = REPLACE(capability_allowlist_json, '"tyrum.http.request"', '') WHERE capability_allowlist_json LIKE '%tyrum.http.request%';

-- connections.capabilities_json
UPDATE connections SET capabilities_json = REPLACE(capabilities_json, '"tyrum.http.request",', '') WHERE capabilities_json LIKE '%tyrum.http.request%';
UPDATE connections SET capabilities_json = REPLACE(capabilities_json, ',"tyrum.http.request"', '') WHERE capabilities_json LIKE '%tyrum.http.request%';
UPDATE connections SET capabilities_json = REPLACE(capabilities_json, '"tyrum.http.request"', '') WHERE capabilities_json LIKE '%tyrum.http.request%';

-- connections.ready_capabilities_json
UPDATE connections SET ready_capabilities_json = REPLACE(ready_capabilities_json, '"tyrum.http.request",', '') WHERE ready_capabilities_json LIKE '%tyrum.http.request%';
UPDATE connections SET ready_capabilities_json = REPLACE(ready_capabilities_json, ',"tyrum.http.request"', '') WHERE ready_capabilities_json LIKE '%tyrum.http.request%';
UPDATE connections SET ready_capabilities_json = REPLACE(ready_capabilities_json, '"tyrum.http.request"', '') WHERE ready_capabilities_json LIKE '%tyrum.http.request%';

-- connections.capability_states_json
UPDATE connections SET capability_states_json = REPLACE(capability_states_json, '"tyrum.http.request",', '') WHERE capability_states_json LIKE '%tyrum.http.request%';
UPDATE connections SET capability_states_json = REPLACE(capability_states_json, ',"tyrum.http.request"', '') WHERE capability_states_json LIKE '%tyrum.http.request%';
UPDATE connections SET capability_states_json = REPLACE(capability_states_json, '"tyrum.http.request"', '') WHERE capability_states_json LIKE '%tyrum.http.request%';
