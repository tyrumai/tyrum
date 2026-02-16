# Helm Deployment Runbook

This runbook describes how to deploy the Tyrum control-plane stack to Kubernetes
using the `infra/helm/tyrum-core` chart. The chart ships the Rust services
(`policy`, `api`), the Next.js web console, the mock LLM, and the data tier
(Postgres + Redis cluster) with default ConfigMaps, Secrets, Horizontal Pod
Autoscalers, and Helm tests.

## Prerequisites
- Docker 24+
- Helm 3.9+
- Access to a Kubernetes cluster (local [`kind`](https://kind.sigs.k8s.io/) or
  remote). For local validation the commands below assume `kind`.
- `kubectl` with credentials for the target cluster.

## Build and Load Images
The chart expects the `:local` image tags used by `docker-compose`. Build the
images and, if using kind, load them into the cluster before installing:

```bash
# From the repository root
docker build -f Dockerfile.policy -t tyrum/policy:local .
docker build -f Dockerfile.api -t tyrum/api:local .
docker build -f web/Dockerfile -t tyrum/web:local web/
docker build -f services/mock_llm/Dockerfile -t tyrum/mock-llm:local services/mock_llm/

# kind only: load the images into the cluster
kind load docker-image tyrum/policy:local tyrum/api:local tyrum/web:local tyrum/mock-llm:local
```

## Install the Chart
```bash
# Create a namespace for Tyrum components
kubectl create namespace tyrum-core || true

# Deploy the release with default settings
helm install tyrum-core infra/helm/tyrum-core \
  --namespace tyrum-core
```

The release provisions:
- `ConfigMap` and `Secret` objects per service containing the runtime settings.
- Deployments for policy, api, web, mock-llm, and postgres.
- A Redis `StatefulSet` (3 replicas) with persistent volumes, a headless
  discovery service, and the `redis-cluster-init` bootstrap hook.
- Services exposing the container ports inside the cluster.
- HorizontalPodAutoscalers for the stateless workloads with tuned CPU & memory
  targets.

## Validate the Deployment
Run the packaged Helm tests to ensure the core endpoints respond as expected:

```bash
helm test tyrum-core --namespace tyrum-core
```

Each test pod performs a health probe against its service (HTTP checks for
policy/api/web/mock-llm, `pg_isready` for Postgres, and a `redis-cli cluster
info` smoke test for Redis). All pods and HPAs should report healthy status
before concluding the deployment.

## Tuning Options
Override `values.yaml` to customise the stack:

- **Images**: set `services.<name>.image.repository` and `tag` for production
  registries.
- **Environment configuration**: extend `services.<name>.config` for non-secret
  variables and `services.<name>.secrets` for secret values (rendered as
  `Secret` resources).
- **Autoscaling**: adjust `services.<name>.hpa.*` for replica ranges and target
  utilisation. Disable per workload by setting `services.<name>.hpa.enabled`
  to `false`.
- **Persistence**: swap `services.postgres.volumes` to reference a `PersistentVolumeClaim`.
- **Ingress**: expose `services.web.service` via an ingress controller or
  service type `LoadBalancer` by overriding `service.type`.

### Redis cluster profiles

Redis ships in clustered mode by default:

- `services.redis.cluster.enabled=true` keeps a three-node `StatefulSet` with
  persistent volumes. The post-install `redis-cluster-init` job waits for the
  pods and allocates hash slots.
- For local development, disable clustering with `--set
  services.redis.cluster.enabled=false`. The chart automatically falls back to a
  single-replica `Deployment`, drops the headless service, and reuses the
  original `redis-server --appendonly no` command.

You can override the storage profile by adjusting
`services.redis.cluster.persistence` (volume name, requested size, storage
class, access modes). If you supply a custom
`services.redis.volumeClaimTemplates`, the template bypasses the generated
claim definition.

### Autoscaling baselines (M2 reliability)

The default HPAs reflect the M2 reliability runbook. CPU targets are paired with
memory utilisation to keep latency predictable under burst load. Override these
values per environment when you have empirical data.

| Service | Min | Max | CPU % | Memory % |
|---------|-----|-----|-------|----------|
| `policy` | 2 | 6 | 55 | 70 |
| `planner` | 3 | 9 | 50 | 65 |
| `web` | 2 | 8 | 55 | 70 |

Example override file:

```yaml
services:
  api:
    image:
      repository: ghcr.io/rhernaus/tyrum-api
      tag: v0.2.3
    hpa:
      minReplicas: 2
      maxReplicas: 5
      targetCPUUtilizationPercentage: 55
      targetMemoryUtilizationPercentage: 70
  web:
    service:
      type: LoadBalancer
```

Apply overrides via `helm install -f my-overrides.yaml` or `helm upgrade`.

## Tear-down
```bash
helm uninstall tyrum-core --namespace tyrum-core
kubectl delete namespace tyrum-core
```

Keep the namespace when using shared clusters to preserve secrets and network
policies.
