CREATE TABLE location_profiles (
  tenant_id         TEXT NOT NULL,
  agent_id          TEXT NOT NULL,
  primary_node_id   TEXT,
  stream_enabled    INTEGER NOT NULL DEFAULT 1 CHECK (stream_enabled IN (0, 1)),
  distance_filter_m INTEGER NOT NULL DEFAULT 100,
  max_interval_ms   INTEGER NOT NULL DEFAULT 900000,
  max_accuracy_m    INTEGER NOT NULL DEFAULT 100,
  background_enabled INTEGER NOT NULL DEFAULT 1 CHECK (background_enabled IN (0, 1)),
  poi_provider_kind TEXT NOT NULL DEFAULT 'none' CHECK (poi_provider_kind IN ('none', 'osm_overpass')),
  created_at        TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at        TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (tenant_id, agent_id),
  FOREIGN KEY (tenant_id, agent_id) REFERENCES agents(tenant_id, agent_id) ON DELETE CASCADE
);

CREATE TABLE location_places (
  tenant_id         TEXT NOT NULL,
  agent_id          TEXT NOT NULL,
  place_id          TEXT NOT NULL,
  name              TEXT NOT NULL,
  latitude          REAL NOT NULL,
  longitude         REAL NOT NULL,
  radius_m          INTEGER NOT NULL,
  tags_json         TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(tags_json)),
  source            TEXT NOT NULL CHECK (source IN ('manual', 'poi_provider')),
  provider_place_id TEXT,
  metadata_json     TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(metadata_json)),
  created_at        TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at        TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (tenant_id, place_id),
  FOREIGN KEY (tenant_id, agent_id) REFERENCES agents(tenant_id, agent_id) ON DELETE CASCADE
);

CREATE TABLE location_samples (
  tenant_id            TEXT NOT NULL,
  agent_id             TEXT NOT NULL,
  sample_id            TEXT NOT NULL,
  node_id              TEXT NOT NULL,
  recorded_at          TEXT NOT NULL,
  latitude             REAL NOT NULL,
  longitude            REAL NOT NULL,
  accuracy_m           REAL NOT NULL,
  altitude_m           REAL,
  altitude_accuracy_m  REAL,
  heading_deg          REAL,
  speed_mps            REAL,
  source               TEXT NOT NULL CHECK (source IN ('gps', 'network', 'passive', 'unknown')),
  is_background        INTEGER NOT NULL DEFAULT 0 CHECK (is_background IN (0, 1)),
  accepted             INTEGER NOT NULL DEFAULT 0 CHECK (accepted IN (0, 1)),
  created_at           TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (tenant_id, sample_id),
  FOREIGN KEY (tenant_id, agent_id) REFERENCES agents(tenant_id, agent_id) ON DELETE CASCADE
);

CREATE TABLE location_subject_states (
  tenant_id         TEXT NOT NULL,
  agent_id          TEXT NOT NULL,
  node_id           TEXT NOT NULL,
  subject_kind      TEXT NOT NULL CHECK (subject_kind IN ('saved_place', 'poi_category')),
  subject_ref       TEXT NOT NULL,
  status            TEXT NOT NULL CHECK (status IN ('inside', 'outside')),
  entered_at        TEXT,
  dwell_emitted_at  TEXT,
  updated_at        TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (tenant_id, agent_id, node_id, subject_kind, subject_ref),
  FOREIGN KEY (tenant_id, agent_id) REFERENCES agents(tenant_id, agent_id) ON DELETE CASCADE
);

CREATE TABLE location_events (
  tenant_id            TEXT NOT NULL,
  agent_id             TEXT NOT NULL,
  event_id             TEXT NOT NULL,
  sample_id            TEXT NOT NULL,
  node_id              TEXT NOT NULL,
  event_type           TEXT NOT NULL CHECK (event_type IN (
    'saved_place.enter',
    'saved_place.exit',
    'saved_place.dwell',
    'poi_category.enter',
    'poi_category.exit',
    'poi_category.dwell'
  )),
  transition           TEXT NOT NULL CHECK (transition IN ('enter', 'exit', 'dwell')),
  subject_kind         TEXT NOT NULL CHECK (subject_kind IN ('saved_place', 'poi_category')),
  subject_ref          TEXT NOT NULL,
  place_id             TEXT,
  place_name           TEXT,
  provider_place_id    TEXT,
  category_key         TEXT,
  latitude             REAL NOT NULL,
  longitude            REAL NOT NULL,
  accuracy_m           REAL NOT NULL,
  altitude_m           REAL,
  altitude_accuracy_m  REAL,
  heading_deg          REAL,
  speed_mps            REAL,
  distance_m           REAL,
  metadata_json        TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(metadata_json)),
  occurred_at          TEXT NOT NULL,
  created_at           TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (tenant_id, event_id),
  UNIQUE (tenant_id, agent_id, node_id, sample_id, event_type, subject_kind, subject_ref),
  FOREIGN KEY (tenant_id, agent_id) REFERENCES agents(tenant_id, agent_id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, sample_id) REFERENCES location_samples(tenant_id, sample_id) ON DELETE CASCADE
);

CREATE TABLE automation_triggers (
  tenant_id        TEXT NOT NULL,
  trigger_id       TEXT NOT NULL,
  agent_id         TEXT NOT NULL,
  workspace_id     TEXT NOT NULL,
  trigger_type     TEXT NOT NULL CHECK (trigger_type IN ('location')),
  condition_json   TEXT NOT NULL CHECK (json_valid(condition_json)),
  execution_json   TEXT NOT NULL CHECK (json_valid(execution_json)),
  delivery_mode    TEXT NOT NULL DEFAULT 'notify' CHECK (delivery_mode IN ('quiet', 'notify')),
  enabled          INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  created_at       TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at       TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (tenant_id, trigger_id),
  FOREIGN KEY (tenant_id, agent_id, workspace_id)
    REFERENCES agent_workspaces(tenant_id, agent_id, workspace_id) ON DELETE CASCADE
);

CREATE INDEX idx_location_places_agent ON location_places(tenant_id, agent_id, updated_at DESC);
CREATE INDEX idx_location_samples_agent_recorded ON location_samples(tenant_id, agent_id, recorded_at DESC);
CREATE INDEX idx_location_events_agent_occurred ON location_events(tenant_id, agent_id, occurred_at DESC);
CREATE INDEX idx_automation_triggers_scope ON automation_triggers(tenant_id, agent_id, workspace_id, enabled);
