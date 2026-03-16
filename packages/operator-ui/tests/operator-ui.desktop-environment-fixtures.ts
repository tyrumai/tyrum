export function sampleDesktopEnvironmentHost() {
  return {
    host_id: "host-1",
    label: "Primary runtime",
    version: "0.1.0",
    docker_available: true,
    healthy: true,
    last_seen_at: "2026-03-10T12:00:00.000Z",
    last_error: null,
  } as const;
}

export function sampleDesktopEnvironment() {
  return {
    environment_id: "env-1",
    host_id: "host-1",
    label: "Research desktop",
    image_ref: "registry.example.test/desktop@sha256:1234",
    managed_kind: "docker",
    status: "running",
    desired_running: true,
    node_id: "node-desktop-1",
    takeover_url: "http://127.0.0.1:8788/desktop-environments/env-1/takeover",
    last_seen_at: "2026-03-10T12:00:00.000Z",
    last_error: null,
    created_at: "2026-03-10T12:00:00.000Z",
    updated_at: "2026-03-10T12:00:00.000Z",
  } as const;
}
