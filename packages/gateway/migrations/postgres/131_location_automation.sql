CREATE TABLE location_profiles (
  tenant_id          UUID NOT NULL,
  agent_id           UUID NOT NULL,
  primary_node_id    TEXT,
  stream_enabled     BOOLEAN NOT NULL DEFAULT true,
  distance_filter_m  INTEGER NOT NULL DEFAULT 100,
  max_interval_ms    INTEGER NOT NULL DEFAULT 900000,
  max_accuracy_m     INTEGER NOT NULL DEFAULT 100,
  background_enabled BOOLEAN NOT NULL DEFAULT true,
  poi_provider_kind  TEXT NOT NULL DEFAULT 'none' CHECK (poi_provider_kind IN ('none', 'osm_overpass')),
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, agent_id),
  CONSTRAINT location_profiles_agent_fk
    FOREIGN KEY (tenant_id, agent_id) REFERENCES agents(tenant_id, agent_id) ON DELETE CASCADE
);

CREATE TABLE location_places (
  tenant_id         UUID NOT NULL,
  agent_id          UUID NOT NULL,
  place_id          UUID NOT NULL,
  name              TEXT NOT NULL,
  latitude          DOUBLE PRECISION NOT NULL,
  longitude         DOUBLE PRECISION NOT NULL,
  radius_m          INTEGER NOT NULL,
  tags_json         TEXT NOT NULL DEFAULT '[]' CHECK (pg_input_is_valid(tags_json, 'jsonb')),
  source            TEXT NOT NULL CHECK (source IN ('manual', 'poi_provider')),
  provider_place_id TEXT,
  metadata_json     TEXT NOT NULL DEFAULT '{}' CHECK (pg_input_is_valid(metadata_json, 'jsonb')),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, place_id),
  CONSTRAINT location_places_agent_fk
    FOREIGN KEY (tenant_id, agent_id) REFERENCES agents(tenant_id, agent_id) ON DELETE CASCADE
);

CREATE TABLE location_samples (
  tenant_id           UUID NOT NULL,
  agent_id            UUID NOT NULL,
  sample_id           UUID NOT NULL,
  node_id             TEXT NOT NULL,
  recorded_at         TIMESTAMPTZ NOT NULL,
  latitude            DOUBLE PRECISION NOT NULL,
  longitude           DOUBLE PRECISION NOT NULL,
  accuracy_m          DOUBLE PRECISION NOT NULL,
  altitude_m          DOUBLE PRECISION,
  altitude_accuracy_m DOUBLE PRECISION,
  heading_deg         DOUBLE PRECISION,
  speed_mps           DOUBLE PRECISION,
  source              TEXT NOT NULL CHECK (source IN ('gps', 'network', 'passive', 'unknown')),
  is_background       BOOLEAN NOT NULL DEFAULT false,
  accepted            BOOLEAN NOT NULL DEFAULT false,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, sample_id),
  CONSTRAINT location_samples_agent_fk
    FOREIGN KEY (tenant_id, agent_id) REFERENCES agents(tenant_id, agent_id) ON DELETE CASCADE
);

CREATE TABLE location_subject_states (
  tenant_id        UUID NOT NULL,
  agent_id         UUID NOT NULL,
  node_id          TEXT NOT NULL,
  subject_kind     TEXT NOT NULL CHECK (subject_kind IN ('saved_place', 'poi_category')),
  subject_ref      TEXT NOT NULL,
  status           TEXT NOT NULL CHECK (status IN ('inside', 'outside')),
  entered_at       TIMESTAMPTZ,
  dwell_emitted_at TIMESTAMPTZ,
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, agent_id, node_id, subject_kind, subject_ref),
  CONSTRAINT location_subject_states_agent_fk
    FOREIGN KEY (tenant_id, agent_id) REFERENCES agents(tenant_id, agent_id) ON DELETE CASCADE
);

CREATE TABLE location_events (
  tenant_id           UUID NOT NULL,
  agent_id            UUID NOT NULL,
  event_id            UUID NOT NULL,
  sample_id           UUID NOT NULL,
  node_id             TEXT NOT NULL,
  event_type          TEXT NOT NULL CHECK (event_type IN (
    'saved_place.enter',
    'saved_place.exit',
    'saved_place.dwell',
    'poi_category.enter',
    'poi_category.exit',
    'poi_category.dwell'
  )),
  transition          TEXT NOT NULL CHECK (transition IN ('enter', 'exit', 'dwell')),
  subject_kind        TEXT NOT NULL CHECK (subject_kind IN ('saved_place', 'poi_category')),
  subject_ref         TEXT NOT NULL,
  place_id            UUID,
  place_name          TEXT,
  provider_place_id   TEXT,
  category_key        TEXT,
  latitude            DOUBLE PRECISION NOT NULL,
  longitude           DOUBLE PRECISION NOT NULL,
  accuracy_m          DOUBLE PRECISION NOT NULL,
  altitude_m          DOUBLE PRECISION,
  altitude_accuracy_m DOUBLE PRECISION,
  heading_deg         DOUBLE PRECISION,
  speed_mps           DOUBLE PRECISION,
  distance_m          DOUBLE PRECISION,
  metadata_json       TEXT NOT NULL DEFAULT '{}' CHECK (pg_input_is_valid(metadata_json, 'jsonb')),
  occurred_at         TIMESTAMPTZ NOT NULL,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, event_id),
  UNIQUE (tenant_id, agent_id, node_id, sample_id, event_type, subject_kind, subject_ref),
  CONSTRAINT location_events_agent_fk
    FOREIGN KEY (tenant_id, agent_id) REFERENCES agents(tenant_id, agent_id) ON DELETE CASCADE,
  CONSTRAINT location_events_sample_fk
    FOREIGN KEY (tenant_id, sample_id) REFERENCES location_samples(tenant_id, sample_id) ON DELETE CASCADE
);

CREATE TABLE automation_triggers (
  tenant_id      UUID NOT NULL,
  trigger_id     UUID NOT NULL,
  agent_id       UUID NOT NULL,
  workspace_id   UUID NOT NULL,
  trigger_type   TEXT NOT NULL CHECK (trigger_type IN ('location')),
  condition_json TEXT NOT NULL CHECK (pg_input_is_valid(condition_json, 'jsonb')),
  execution_json TEXT NOT NULL CHECK (pg_input_is_valid(execution_json, 'jsonb')),
  delivery_mode  TEXT NOT NULL DEFAULT 'notify' CHECK (delivery_mode IN ('quiet', 'notify')),
  enabled        BOOLEAN NOT NULL DEFAULT true,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, trigger_id),
  CONSTRAINT automation_triggers_membership_fk
    FOREIGN KEY (tenant_id, agent_id, workspace_id)
    REFERENCES agent_workspaces(tenant_id, agent_id, workspace_id) ON DELETE CASCADE
);

CREATE INDEX idx_location_places_agent ON location_places(tenant_id, agent_id, updated_at DESC);
CREATE INDEX idx_location_samples_agent_recorded ON location_samples(tenant_id, agent_id, recorded_at DESC);
CREATE INDEX idx_location_events_agent_occurred ON location_events(tenant_id, agent_id, occurred_at DESC);
CREATE INDEX idx_automation_triggers_scope ON automation_triggers(tenant_id, agent_id, workspace_id, enabled);
