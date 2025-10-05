# Helm Deployment Runbook

This runbook describes how to deploy the Tyrum control-plane stack to Kubernetes
using the `infra/helm/tyrum-core` chart. The chart ships the Rust services
(`policy`, `api`), the Next.js web console, the mock LLM, and development data
stores (Postgres + Redis) with default ConfigMaps, Secrets, Horizontal Pod
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
- Deployments for policy, api, web, mock-llm, postgres, and redis.
- Services exposing the container ports inside the cluster.
- HorizontalPodAutoscalers for the stateless workloads with CPU defaults.

## Validate the Deployment
Run the packaged Helm tests to ensure the core endpoints respond as expected:

```bash
helm test tyrum-core --namespace tyrum-core
```

Each test pod performs a health probe against its service (HTTP checks for
policy/api/web/mock-llm and readiness commands for Postgres/Redis). All pods and
HPAs should report healthy status before concluding the deployment.

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

Example override file:

```yaml
services:
  api:
    image:
      repository: ghcr.io/virtunetbv/tyrum-api
      tag: v0.2.3
    hpa:
      minReplicas: 2
      maxReplicas: 5
      targetCPUUtilizationPercentage: 55
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
