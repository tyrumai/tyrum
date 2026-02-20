# Presence and Instances

Presence is Tyrum’s lightweight, best-effort view of:

- the gateway service itself, and
- operator clients and nodes connected to the gateway.

Presence exists to give operators immediate visibility into “what is connected and healthy” without reading logs.

## Presence entries

Presence entries are structured objects with fields like:

- `instance_id`: stable device identity (derived from the device public key; see [Handshake](./protocol/handshake.md)).
- `role`: `gateway | client | node`.
- `host`: human-friendly host label.
- `ip`: best-effort remote address (with tunnel-aware handling).
- `version`: client/node version string (when provided).
- `mode`: `ui | web | cli | node | backend | probe | test` (used for filtering).
- `last_seen_at`: last update timestamp.
- `last_input_seconds`: optional “seconds since last user input” (when clients report it).
- `reason`: `self | connect | periodic | node-connected`.

## Producers (where presence comes from)

Presence entries are produced by multiple sources and merged:

1. **Gateway self entry:** the gateway always seeds a `role=gateway` entry at startup.
2. **WebSocket connect:** successful `connect.init/connect.proof` upserts a presence entry for the connecting device.
3. **Periodic beacons:** clients can send periodic “system presence” beacons with richer fields (host name, last input, etc.).
4. **Node heartbeats:** nodes periodically refresh their presence while connected.

Short-lived, one-off CLI connections can be excluded from presence by `mode` to avoid spamming operator UIs.

## Merge and dedupe rules

Presence is keyed by stable device identity (`instance_id`). When a device reconnects, Tyrum updates the existing entry instead of creating duplicates.

Tunnel caveat: when a connection arrives through a local port-forward, the gateway may observe `127.0.0.1` as the remote address. In that case, client-reported IP/host fields from periodic beacons take precedence.

## TTL and bounded size

Presence is intentionally ephemeral:

- entries older than a configured TTL are pruned
- total entries are capped (oldest dropped first)

Prunes emit events so UIs can remove stale rows.

## Consumers

Operator surfaces consume presence as:

- an “Instances” panel in the gateway control UI
- `/presence` and `/status` command output
- diagnostics exports for support and debugging

Presence is access-controlled: only authenticated operator clients can view presence entries.

