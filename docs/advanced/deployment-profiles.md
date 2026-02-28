# Deployment Profiles

Tyrum supports two operator-visible deployment profiles:

- `single-host`: a single gateway instance running all roles, backed by SQLite
- `split-role`: separate `gateway-edge`, `worker`, and `scheduler` roles, backed by Postgres

Reference (reproducible) configuration templates live in `config/deployments/`.

## Docker deployments (docker compose)

The repo ships a `docker-compose.yml` with these profiles:

- default: single-host (`tyrum` service)
- `split`: split-role (`tyrum-edge`, `tyrum-worker`, `tyrum-scheduler` + `postgres`)
- `desktop-sandbox`: optional Linux desktop sandbox (Xfce + noVNC) + paired desktop node

> Safety note: `docker-compose.yml` is **local-first**. It allows plaintext HTTP for convenience and publishes Postgres on `5432`. For remote deployments, add firewalling/allowlists, use TLS termination, and set strong database credentials. See `docs/advanced/remote-gateway.md`.

The `desktop-sandbox` profile publishes an unauthenticated desktop takeover endpoint for local use (bound to `127.0.0.1` by default).

### Single-host

```bash
docker compose up -d --build tyrum
docker compose logs -f tyrum
```

The gateway auto-generates an admin token at `${TYRUM_HOME}/.admin-token` if `GATEWAY_TOKEN` is not set.

### Split-role

Split-role requires one shared admin token across all roles:

```bash
cp config/deployments/split-role.env.example config/local.env
# edit config/local.env and set GATEWAY_TOKEN (>=32 chars)
docker compose --env-file config/local.env --profile split up -d --build postgres tyrum-edge tyrum-worker tyrum-scheduler
```

## Kubernetes deployments (Helm)

The repo ships a Helm chart in `charts/tyrum`.

### Single-host

```bash
helm install tyrum charts/tyrum -f config/deployments/helm-single.values.yaml
```

### Split-role

Split-role requires Postgres:

```bash
helm install tyrum charts/tyrum -f config/deployments/helm-split-role.values.yaml
```

Replace `REPLACE_ME` in `config/deployments/helm-split-role.values.yaml` with your Postgres password (or set `env.GATEWAY_DB_PATH` to your full Postgres URI).

Once `env.GATEWAY_DB_PATH` contains real credentials, treat the resulting Helm values as sensitive (avoid committing it; prefer an untracked values file or a secret manager workflow).
