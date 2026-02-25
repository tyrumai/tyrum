# Deployment profiles

This folder contains **reference** (operator-facing) configuration templates for the two supported deployment profiles:

- `single-host` — one gateway process running all roles, backed by SQLite
- `split-role` — separate `gateway-edge`, `worker`, and `scheduler` roles, backed by Postgres

Templates are intentionally safe-by-default:

- No secrets are committed. Generate/set `GATEWAY_TOKEN` locally.
- Split-role examples use `postgres://...` to avoid unsupported split-on-SQLite deployments.

See `docs/advanced/deployment-profiles.md` for usage.
