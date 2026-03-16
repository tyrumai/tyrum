# Deployment Profiles

Tyrum supports two operator-visible deployment profiles:

- `single-host`: a single gateway instance running all roles, backed by SQLite
- `split-role`: separate `gateway-edge`, `worker`, and `scheduler` roles, backed by Postgres

Storage behavior is controlled by a separate runtime state profile:

- `state.mode=local`: mutable runtime state lives under the gateway home (`~/.tyrum` by default; override with `--home`)
- `state.mode=shared`: mutable runtime state moves to shared stores (DB / artifacts / shared secret source)

Recommended mapping:

- desktop / embedded / local single-instance: `single-host` + `state.mode=local`
- remote single gateway: `single-host` + `state.mode=local`
- HA / horizontally scaled service: `split-role` + `state.mode=shared`

Reference (reproducible) configuration templates live in `config/deployments/`.

## Docker deployments (docker compose)

The repo ships a `docker-compose.yml` with these profiles:

- default: single-host (`tyrum` service)
- `split`: split-role (`tyrum-edge`, `tyrum-worker`, `tyrum-scheduler` + `postgres`)
- `desktop-sandbox`: optional Linux desktop sandbox (Xfce + noVNC) + paired desktop node

> Safety note: `docker-compose.yml` is **local-first**. It allows plaintext HTTP for convenience and publishes Postgres on `5432`. For remote deployments, add firewalling/allowlists, use TLS termination, and set strong database credentials. See `docs/advanced/remote-gateway.md`.

The `desktop-sandbox` profile publishes a local noVNC desktop endpoint (bound to `127.0.0.1` by default). The gateway's desktop takeover redirect remains an admin-authenticated control-plane route.

### Single-host

```bash
docker compose up -d --build tyrum
docker compose logs -f tyrum
```

The gateway prints bootstrap tokens to stdout once on first startup. Capture the `default-tenant-admin` token for operator sign-in.

### Split-role

Optionally set one shared tenant admin token across all roles if you want a stable provisioned token:

```bash
cp config/deployments/split-role.env.example config/local.env
# optional: edit config/local.env and set GATEWAY_TOKEN
docker compose --env-file config/local.env --profile split up -d --build postgres tyrum-edge tyrum-worker tyrum-scheduler
```

If `GATEWAY_TOKEN` is unset, the gateway prints bootstrap tokens once on first startup instead.

For HA/shared cutover from an existing local home:

1. Set the deployment to `state.mode=shared`.
2. Use shared Postgres instead of SQLite.
3. Configure shared artifact storage instead of local fs artifacts.
4. Provide one shared secret key source for all instances (for example `TYRUM_SHARED_MASTER_KEY_B64` or an equivalent external secret source).
5. Recreate mutable runtime config in the shared DB-backed operator/config surfaces before switching traffic. There is no filesystem import command.

In shared mode, mutable runtime state must not depend on the local gateway home. Bundled read-only assets remain valid.

## Kubernetes deployments (Helm)

The repo ships a Helm chart in `charts/tyrum`.

Helm bootstrap settings live under `runtime.*`. Environment variables under `env.*` only cover process env inputs that the runtime still consumes.
After first boot, persistent server/execution/agent changes live under `/system/deployment-config`.

### Single-host

```bash
helm install tyrum charts/tyrum -f config/deployments/helm-single.values.yaml
```

### Split-role

Split-role requires Postgres:

```bash
helm install tyrum charts/tyrum -f config/deployments/helm-split-role.values.yaml
```

Replace `REPLACE_ME` in `config/deployments/helm-split-role.values.yaml` with your Postgres password (or set `runtime.db` to your full Postgres URI).

Once `runtime.db` contains real credentials, treat the resulting Helm values as sensitive (avoid committing it; prefer an untracked values file or a secret manager workflow).
