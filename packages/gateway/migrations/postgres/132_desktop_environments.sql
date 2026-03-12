CREATE TABLE IF NOT EXISTS desktop_environment_hosts (
  host_id TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  version TEXT,
  docker_available INTEGER NOT NULL DEFAULT 0,
  healthy INTEGER NOT NULL DEFAULT 0,
  last_seen_at TEXT,
  last_error TEXT,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS desktop_environments (
  tenant_id TEXT NOT NULL,
  environment_id TEXT NOT NULL,
  host_id TEXT NOT NULL,
  label TEXT,
  image_ref TEXT NOT NULL,
  managed_kind TEXT NOT NULL DEFAULT 'docker',
  status TEXT NOT NULL DEFAULT 'pending',
  desired_running INTEGER NOT NULL DEFAULT 0,
  node_id TEXT,
  takeover_url TEXT,
  logs_json TEXT NOT NULL DEFAULT '[]',
  last_seen_at TEXT,
  last_error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id, environment_id),
  CONSTRAINT fk_desktop_environments_host
    FOREIGN KEY (host_id) REFERENCES desktop_environment_hosts(host_id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_desktop_environments_tenant_updated
  ON desktop_environments (tenant_id, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_desktop_environments_host_updated
  ON desktop_environments (host_id, updated_at DESC);
