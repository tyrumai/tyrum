-- Canonicalize legacy platform-prefixed capability IDs to unified form.
-- Each REPLACE is safe to re-run (idempotent).

-- tyrum.ios.location.get-current → tyrum.location.get
UPDATE node_pairings SET capabilities_json = REPLACE(capabilities_json, '"tyrum.ios.location.get-current"', '"tyrum.location.get"') WHERE capabilities_json LIKE '%tyrum.ios.location.get-current%';
UPDATE node_pairings SET capability_allowlist_json = REPLACE(capability_allowlist_json, '"tyrum.ios.location.get-current"', '"tyrum.location.get"') WHERE capability_allowlist_json LIKE '%tyrum.ios.location.get-current%';
UPDATE connections SET capabilities_json = REPLACE(capabilities_json, '"tyrum.ios.location.get-current"', '"tyrum.location.get"') WHERE capabilities_json LIKE '%tyrum.ios.location.get-current%';
UPDATE connections SET ready_capabilities_json = REPLACE(ready_capabilities_json, '"tyrum.ios.location.get-current"', '"tyrum.location.get"') WHERE ready_capabilities_json LIKE '%tyrum.ios.location.get-current%';
UPDATE connections SET capability_states_json = REPLACE(capability_states_json, '"tyrum.ios.location.get-current"', '"tyrum.location.get"') WHERE capability_states_json LIKE '%tyrum.ios.location.get-current%';

-- tyrum.ios.camera.capture-photo → tyrum.camera.capture-photo
UPDATE node_pairings SET capabilities_json = REPLACE(capabilities_json, '"tyrum.ios.camera.capture-photo"', '"tyrum.camera.capture-photo"') WHERE capabilities_json LIKE '%tyrum.ios.camera.capture-photo%';
UPDATE node_pairings SET capability_allowlist_json = REPLACE(capability_allowlist_json, '"tyrum.ios.camera.capture-photo"', '"tyrum.camera.capture-photo"') WHERE capability_allowlist_json LIKE '%tyrum.ios.camera.capture-photo%';
UPDATE connections SET capabilities_json = REPLACE(capabilities_json, '"tyrum.ios.camera.capture-photo"', '"tyrum.camera.capture-photo"') WHERE capabilities_json LIKE '%tyrum.ios.camera.capture-photo%';
UPDATE connections SET ready_capabilities_json = REPLACE(ready_capabilities_json, '"tyrum.ios.camera.capture-photo"', '"tyrum.camera.capture-photo"') WHERE ready_capabilities_json LIKE '%tyrum.ios.camera.capture-photo%';
UPDATE connections SET capability_states_json = REPLACE(capability_states_json, '"tyrum.ios.camera.capture-photo"', '"tyrum.camera.capture-photo"') WHERE capability_states_json LIKE '%tyrum.ios.camera.capture-photo%';

-- tyrum.ios.audio.record-clip → tyrum.audio.record
UPDATE node_pairings SET capabilities_json = REPLACE(capabilities_json, '"tyrum.ios.audio.record-clip"', '"tyrum.audio.record"') WHERE capabilities_json LIKE '%tyrum.ios.audio.record-clip%';
UPDATE node_pairings SET capability_allowlist_json = REPLACE(capability_allowlist_json, '"tyrum.ios.audio.record-clip"', '"tyrum.audio.record"') WHERE capability_allowlist_json LIKE '%tyrum.ios.audio.record-clip%';
UPDATE connections SET capabilities_json = REPLACE(capabilities_json, '"tyrum.ios.audio.record-clip"', '"tyrum.audio.record"') WHERE capabilities_json LIKE '%tyrum.ios.audio.record-clip%';
UPDATE connections SET ready_capabilities_json = REPLACE(ready_capabilities_json, '"tyrum.ios.audio.record-clip"', '"tyrum.audio.record"') WHERE ready_capabilities_json LIKE '%tyrum.ios.audio.record-clip%';
UPDATE connections SET capability_states_json = REPLACE(capability_states_json, '"tyrum.ios.audio.record-clip"', '"tyrum.audio.record"') WHERE capability_states_json LIKE '%tyrum.ios.audio.record-clip%';

-- tyrum.android.location.get-current → tyrum.location.get
UPDATE node_pairings SET capabilities_json = REPLACE(capabilities_json, '"tyrum.android.location.get-current"', '"tyrum.location.get"') WHERE capabilities_json LIKE '%tyrum.android.location.get-current%';
UPDATE node_pairings SET capability_allowlist_json = REPLACE(capability_allowlist_json, '"tyrum.android.location.get-current"', '"tyrum.location.get"') WHERE capability_allowlist_json LIKE '%tyrum.android.location.get-current%';
UPDATE connections SET capabilities_json = REPLACE(capabilities_json, '"tyrum.android.location.get-current"', '"tyrum.location.get"') WHERE capabilities_json LIKE '%tyrum.android.location.get-current%';
UPDATE connections SET ready_capabilities_json = REPLACE(ready_capabilities_json, '"tyrum.android.location.get-current"', '"tyrum.location.get"') WHERE ready_capabilities_json LIKE '%tyrum.android.location.get-current%';
UPDATE connections SET capability_states_json = REPLACE(capability_states_json, '"tyrum.android.location.get-current"', '"tyrum.location.get"') WHERE capability_states_json LIKE '%tyrum.android.location.get-current%';

-- tyrum.android.camera.capture-photo → tyrum.camera.capture-photo
UPDATE node_pairings SET capabilities_json = REPLACE(capabilities_json, '"tyrum.android.camera.capture-photo"', '"tyrum.camera.capture-photo"') WHERE capabilities_json LIKE '%tyrum.android.camera.capture-photo%';
UPDATE node_pairings SET capability_allowlist_json = REPLACE(capability_allowlist_json, '"tyrum.android.camera.capture-photo"', '"tyrum.camera.capture-photo"') WHERE capability_allowlist_json LIKE '%tyrum.android.camera.capture-photo%';
UPDATE connections SET capabilities_json = REPLACE(capabilities_json, '"tyrum.android.camera.capture-photo"', '"tyrum.camera.capture-photo"') WHERE capabilities_json LIKE '%tyrum.android.camera.capture-photo%';
UPDATE connections SET ready_capabilities_json = REPLACE(ready_capabilities_json, '"tyrum.android.camera.capture-photo"', '"tyrum.camera.capture-photo"') WHERE ready_capabilities_json LIKE '%tyrum.android.camera.capture-photo%';
UPDATE connections SET capability_states_json = REPLACE(capability_states_json, '"tyrum.android.camera.capture-photo"', '"tyrum.camera.capture-photo"') WHERE capability_states_json LIKE '%tyrum.android.camera.capture-photo%';

-- tyrum.android.audio.record-clip → tyrum.audio.record
UPDATE node_pairings SET capabilities_json = REPLACE(capabilities_json, '"tyrum.android.audio.record-clip"', '"tyrum.audio.record"') WHERE capabilities_json LIKE '%tyrum.android.audio.record-clip%';
UPDATE node_pairings SET capability_allowlist_json = REPLACE(capability_allowlist_json, '"tyrum.android.audio.record-clip"', '"tyrum.audio.record"') WHERE capability_allowlist_json LIKE '%tyrum.android.audio.record-clip%';
UPDATE connections SET capabilities_json = REPLACE(capabilities_json, '"tyrum.android.audio.record-clip"', '"tyrum.audio.record"') WHERE capabilities_json LIKE '%tyrum.android.audio.record-clip%';
UPDATE connections SET ready_capabilities_json = REPLACE(ready_capabilities_json, '"tyrum.android.audio.record-clip"', '"tyrum.audio.record"') WHERE ready_capabilities_json LIKE '%tyrum.android.audio.record-clip%';
UPDATE connections SET capability_states_json = REPLACE(capability_states_json, '"tyrum.android.audio.record-clip"', '"tyrum.audio.record"') WHERE capability_states_json LIKE '%tyrum.android.audio.record-clip%';

-- tyrum.browser.geolocation.get → tyrum.location.get
UPDATE node_pairings SET capabilities_json = REPLACE(capabilities_json, '"tyrum.browser.geolocation.get"', '"tyrum.location.get"') WHERE capabilities_json LIKE '%tyrum.browser.geolocation.get%';
UPDATE node_pairings SET capability_allowlist_json = REPLACE(capability_allowlist_json, '"tyrum.browser.geolocation.get"', '"tyrum.location.get"') WHERE capability_allowlist_json LIKE '%tyrum.browser.geolocation.get%';
UPDATE connections SET capabilities_json = REPLACE(capabilities_json, '"tyrum.browser.geolocation.get"', '"tyrum.location.get"') WHERE capabilities_json LIKE '%tyrum.browser.geolocation.get%';
UPDATE connections SET ready_capabilities_json = REPLACE(ready_capabilities_json, '"tyrum.browser.geolocation.get"', '"tyrum.location.get"') WHERE ready_capabilities_json LIKE '%tyrum.browser.geolocation.get%';
UPDATE connections SET capability_states_json = REPLACE(capability_states_json, '"tyrum.browser.geolocation.get"', '"tyrum.location.get"') WHERE capability_states_json LIKE '%tyrum.browser.geolocation.get%';

-- tyrum.browser.camera.capture-photo → tyrum.camera.capture-photo
UPDATE node_pairings SET capabilities_json = REPLACE(capabilities_json, '"tyrum.browser.camera.capture-photo"', '"tyrum.camera.capture-photo"') WHERE capabilities_json LIKE '%tyrum.browser.camera.capture-photo%';
UPDATE node_pairings SET capability_allowlist_json = REPLACE(capability_allowlist_json, '"tyrum.browser.camera.capture-photo"', '"tyrum.camera.capture-photo"') WHERE capability_allowlist_json LIKE '%tyrum.browser.camera.capture-photo%';
UPDATE connections SET capabilities_json = REPLACE(capabilities_json, '"tyrum.browser.camera.capture-photo"', '"tyrum.camera.capture-photo"') WHERE capabilities_json LIKE '%tyrum.browser.camera.capture-photo%';
UPDATE connections SET ready_capabilities_json = REPLACE(ready_capabilities_json, '"tyrum.browser.camera.capture-photo"', '"tyrum.camera.capture-photo"') WHERE ready_capabilities_json LIKE '%tyrum.browser.camera.capture-photo%';
UPDATE connections SET capability_states_json = REPLACE(capability_states_json, '"tyrum.browser.camera.capture-photo"', '"tyrum.camera.capture-photo"') WHERE capability_states_json LIKE '%tyrum.browser.camera.capture-photo%';

-- tyrum.browser.microphone.record → tyrum.audio.record
UPDATE node_pairings SET capabilities_json = REPLACE(capabilities_json, '"tyrum.browser.microphone.record"', '"tyrum.audio.record"') WHERE capabilities_json LIKE '%tyrum.browser.microphone.record%';
UPDATE node_pairings SET capability_allowlist_json = REPLACE(capability_allowlist_json, '"tyrum.browser.microphone.record"', '"tyrum.audio.record"') WHERE capability_allowlist_json LIKE '%tyrum.browser.microphone.record%';
UPDATE connections SET capabilities_json = REPLACE(capabilities_json, '"tyrum.browser.microphone.record"', '"tyrum.audio.record"') WHERE capabilities_json LIKE '%tyrum.browser.microphone.record%';
UPDATE connections SET ready_capabilities_json = REPLACE(ready_capabilities_json, '"tyrum.browser.microphone.record"', '"tyrum.audio.record"') WHERE ready_capabilities_json LIKE '%tyrum.browser.microphone.record%';
UPDATE connections SET capability_states_json = REPLACE(capability_states_json, '"tyrum.browser.microphone.record"', '"tyrum.audio.record"') WHERE capability_states_json LIKE '%tyrum.browser.microphone.record%';

-- tyrum.cli → tyrum.cli.execute
-- REPLACE is safe: '"tyrum.cli"' (with closing quote) won't match inside '"tyrum.cli.execute"'
UPDATE node_pairings SET capabilities_json = REPLACE(capabilities_json, '"tyrum.cli"', '"tyrum.cli.execute"') WHERE capabilities_json LIKE '%"tyrum.cli"%';
UPDATE node_pairings SET capability_allowlist_json = REPLACE(capability_allowlist_json, '"tyrum.cli"', '"tyrum.cli.execute"') WHERE capability_allowlist_json LIKE '%"tyrum.cli"%';
UPDATE connections SET capabilities_json = REPLACE(capabilities_json, '"tyrum.cli"', '"tyrum.cli.execute"') WHERE capabilities_json LIKE '%"tyrum.cli"%';
UPDATE connections SET ready_capabilities_json = REPLACE(ready_capabilities_json, '"tyrum.cli"', '"tyrum.cli.execute"') WHERE ready_capabilities_json LIKE '%"tyrum.cli"%';
UPDATE connections SET capability_states_json = REPLACE(capability_states_json, '"tyrum.cli"', '"tyrum.cli.execute"') WHERE capability_states_json LIKE '%"tyrum.cli"%';

-- tyrum.http → tyrum.http.request
-- REPLACE is safe: '"tyrum.http"' (with closing quote) won't match inside '"tyrum.http.request"'
UPDATE node_pairings SET capabilities_json = REPLACE(capabilities_json, '"tyrum.http"', '"tyrum.http.request"') WHERE capabilities_json LIKE '%"tyrum.http"%';
UPDATE node_pairings SET capability_allowlist_json = REPLACE(capability_allowlist_json, '"tyrum.http"', '"tyrum.http.request"') WHERE capability_allowlist_json LIKE '%"tyrum.http"%';
UPDATE connections SET capabilities_json = REPLACE(capabilities_json, '"tyrum.http"', '"tyrum.http.request"') WHERE capabilities_json LIKE '%"tyrum.http"%';
UPDATE connections SET ready_capabilities_json = REPLACE(ready_capabilities_json, '"tyrum.http"', '"tyrum.http.request"') WHERE ready_capabilities_json LIKE '%"tyrum.http"%';
UPDATE connections SET capability_states_json = REPLACE(capability_states_json, '"tyrum.http"', '"tyrum.http.request"') WHERE capability_states_json LIKE '%"tyrum.http"%';
