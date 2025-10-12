# Staging Infrastructure Runbook

This runbook captures the day-one operational procedures for Tyrum's staging
environment. It covers Helm-based application rollouts, rollback mechanics, and secret rotations, plus links to
observability dashboards and alerting paths required for readiness checks.

## Access & Prerequisites
- Helm 3.9+, kubectl 1.30+, the AWS CLI, and `jq` must be installed.
- Log in with the staging profile: `aws sso login --profile virtunet-staging`.
- Export the profile before invoking kubectl:
  ```bash
  export AWS_PROFILE=virtunet-staging
  ```
- Ensure you have bastion/VPN access to the staging VPC for private endpoints
  and that your machine's SSH key is registered with the infra team.

## Helm Upgrade Workflow
1. Pull the latest container tags earmarked for staging (e.g. from the release
   notes or GitHub container registry) and update `infra/helm/tyrum-core/values.yaml`
   or the environment overlay you use for staging.
2. Refresh kubeconfig and confirm access:
   ```bash
   aws eks update-kubeconfig --name tyrum-staging-eks --region eu-west-1
   kubectl config use-context arn:aws:eks:eu-west-1:$(aws sts get-caller-identity --query Account --output text):cluster/tyrum-staging-eks
   ```
3. Perform a dry-run to review rendered manifests:
   ```bash
   helm upgrade tyrum-core infra/helm/tyrum-core \
     --namespace tyrum-core \
     --install \
     --dry-run \
     --values infra/helm/tyrum-core/values.yaml
   ```
4. Apply the upgrade once the dry-run looks correct:
   ```bash
   helm upgrade tyrum-core infra/helm/tyrum-core \
     --namespace tyrum-core \
     --install \
     --values infra/helm/tyrum-core/values.yaml
   ```
5. Wait for rollouts to complete and run Helm tests:
   ```bash
   kubectl rollout status deployment/tyrum-core-api --namespace tyrum-core
   kubectl rollout status deployment/tyrum-core-policy --namespace tyrum-core
   kubectl rollout status deployment/tyrum-core-web --namespace tyrum-core
   kubectl rollout status statefulset/tyrum-core-redis --namespace tyrum-core
   helm test tyrum-core --namespace tyrum-core
   kubectl logs job/tyrum-core-redis-cluster-init --namespace tyrum-core
   kubectl get hpa --namespace tyrum-core | grep -E 'policy|planner|web'
   ```
6. Validate service health via the staging ingress (replace `<ingress-host>` with
   the DNS record returned by `kubectl get ingress`):
   ```bash
   curl -I https://<ingress-host>/api/healthz
   curl -I https://<ingress-host>/policy/healthz
   ```

## Rollback Procedures
### Helm Rollback
1. List previous revisions:
   ```bash
   helm history tyrum-core --namespace tyrum-core
   ```
2. Roll back to the last known good revision (replace `REVISION`):
   ```bash
   helm rollback tyrum-core REVISION --namespace tyrum-core
   ```
3. Monitor deployment status and rerun `helm test` to confirm recovery.
4. Annotate the Grafana deployment dashboard with the rollback timestamp and
   root cause.

## Secret Rotation
Staging secrets are managed in AWS Secrets Manager and projected into the
cluster by the Helm chart.

1. Identify the secret to rotate from the staging change ticket or Secrets Manager inventory (`platform_config`, `cluster_bootstrap`, etc.).
2. Set the new payload without deleting previous versions:
  ```bash
  aws secretsmanager put-secret-value \
    --secret-id tyrum-staging/platform/config \
    --secret-string file://~/secrets/platform-config-staging.json
  ```
3. Record the new version ID in the change log for audit coverage.
4. Sync the Kubernetes secret (example for the API deployment). Adjust the key
   extraction if your secret payload stores multiple values:
  ```bash
  SECRET_STRING=$(aws secretsmanager get-secret-value \
    --secret-id tyrum-staging/platform/config \
    --query 'SecretString' \
    --output text)

  kubectl create secret generic tyrum-core-api-secrets \
    --namespace tyrum-core \
    --from-literal=DATABASE_URL="$(jq -r '.database_url' <<<"$SECRET_STRING")" \
    --dry-run=client -o yaml | kubectl apply -f -
  ```
5. Restart impacted workloads to pick up the rotation:
   ```bash
   kubectl rollout restart deployment/tyrum-core-api --namespace tyrum-core
   ```
6. Confirm rotation by checking that pods now reference the latest secret
   resource version (`kubectl describe pod … | grep platform-config`).

## Telegram Ingress (Staging)
- Context: [#58](https://github.com/VirtunetBV/tyrum/issues/58), [#59](https://github.com/VirtunetBV/tyrum/issues/59), [#60](https://github.com/VirtunetBV/tyrum/issues/60), [#61](https://github.com/VirtunetBV/tyrum/issues/61), [#62](https://github.com/VirtunetBV/tyrum/issues/62). Complete these upstream changes before altering ingress settings.
- Prerequisites: the Secrets Manager envelope `tyrum-staging/platform/config` must include the Telegram environment block and the dedicated secret `tyrum-staging/integrations/telegram` must hold `bot_token`, `webhook_url`, and `secret_token`. Tokens stay in Secrets Manager or the staged GitHub environment; never commit them or paste into chat channels.

### Deployment Checklist
1. Resolve the staging ingress hostname with `kubectl get ingress tyrum-core-api --namespace tyrum-core -o jsonpath='{.spec.rules[0].host}'` and confirm it matches the `webhook_url` stored in Secrets Manager.
2. Export the secrets required by the API and GitHub Actions:
   ```bash
   SECRET=$(aws secretsmanager get-secret-value \
     --secret-id tyrum-staging/integrations/telegram \
     --query 'SecretString' \
     --output text)

   export TELEGRAM_BOT_TOKEN=$(jq -r '.bot_token' <<<"$SECRET")
   export TELEGRAM_WEBHOOK_URL=$(jq -r '.webhook_url' <<<"$SECRET")
   export TELEGRAM_WEBHOOK_SECRET=$(jq -r '.secret_token' <<<"$SECRET")
   ```
3. Set or update the webhook against Telegram once the API deployment is healthy:
   ```bash
   curl "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/setWebhook" \
     --data-urlencode "url=${TELEGRAM_WEBHOOK_URL}" \
     --data-urlencode "secret_token=${TELEGRAM_WEBHOOK_SECRET}"
   ```
4. Restart the ingestion workloads so Kubernetes refreshes projected secrets:
   ```bash
   kubectl rollout restart deployment/tyrum-core-api --namespace tyrum-core
   kubectl rollout restart deployment/tyrum-telegram-ingestor --namespace tyrum-core || true
   kubectl rollout status deployment/tyrum-core-api --namespace tyrum-core
   ```
   Use the ingestor restart when a dedicated deployment exists; omit it if Telegram handling is bundled into the API rollout.
5. Mirror updated values into the staging GitHub environment (`Settings → Environments → Staging`) for `TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_URL`, and `TELEGRAM_WEBHOOK_SECRET` so CI webhooks remain valid.

### Secret Rotation
- Rotate the BotFather token first, then write it to Secrets Manager:
  ```bash
  aws secretsmanager put-secret-value \
    --secret-id tyrum-staging/integrations/telegram \
    --secret-string '{"bot_token":"<new-token>","webhook_url":"https://staging.tyrum.run/api/telegram/webhook","secret_token":"<new-secret-token>"}'
  ```
  Never log raw tokens; confirm CLI output is redacted before sharing rotation transcripts.
- Regenerate the HMAC secret with `/setwebhook` using the `secret_token` field so signature validation stays aligned with the API.
- Sync the Kubernetes secret projecting these values (update key names if the deployment uses different literals):
  ```bash
  SECRET_STRING=$(aws secretsmanager get-secret-value \
    --secret-id tyrum-staging/integrations/telegram \
    --query 'SecretString' \
    --output text)

  kubectl create secret generic tyrum-telegram-ingestor \
    --namespace tyrum-core \
    --from-literal=TELEGRAM_BOT_TOKEN="$(jq -r '.bot_token' <<<"$SECRET_STRING")" \
    --from-literal=TELEGRAM_WEBHOOK_URL="$(jq -r '.webhook_url' <<<"$SECRET_STRING")" \
    --from-literal=TELEGRAM_WEBHOOK_SECRET="$(jq -r '.secret_token' <<<"$SECRET_STRING")" \
    --dry-run=client -o yaml | kubectl apply -f -
  ```
- Update GitHub Actions environment secrets (`Settings → Environments → Staging`) for all three variables so CI smoke checks align with staging. GitHub masks values by default; avoid echoing tokens in workflows or logs. Document the rotation time and approver in the change log for auditability.

### Validation Commands
Use the staged webhook to replay a signed payload and confirm the API records it without raising authentication errors.

```bash
payload=$(jq -n --argjson timestamp "$(date +%s)" '{update_id:123,message:{message_id:1,date:$timestamp}}')
signature=$(printf '%s' "$payload" \
  | openssl dgst -binary -sha256 -hmac "$TELEGRAM_WEBHOOK_SECRET" \
  | xxd -p -c 256)

curl -X POST "${TELEGRAM_WEBHOOK_URL}" \
  -H "Content-Type: application/json" \
  -H "X-Telegram-Bot-Api-Secret-Token: $TELEGRAM_WEBHOOK_SECRET" \
  -H "X-Telegram-Bot-Api-Signature: sha256=$signature" \
  -d "$payload"
```

Follow with `kubectl logs deployment/tyrum-core-api --namespace tyrum-core | tail -n 20` or the staging Grafana ingress dashboard to confirm the request succeeded and persisted to `ingress_threads`/`ingress_messages`.

### Redis cluster validation
Confirm the Redis cluster formed correctly after the Helm hook runs:

```bash
kubectl exec -n tyrum-core statefulset/tyrum-core-redis -- \
  redis-cli -c cluster info | grep cluster_state

kubectl exec -n tyrum-core statefulset/tyrum-core-redis -- \
  redis-cli -c cluster nodes
```

All three pods should be listed as masters with unique hash-slot ranges and the
`cluster_state:ok` flag.

## Observability & Alerting Links
- Grafana (Control Plane Overview):
  https://grafana.staging.tyrum.run/d/tyrum-control-plane/overview?var-environment=staging
- Grafana (Release Health + HPAs):
  https://grafana.staging.tyrum.run/d/tyrum-release/rollout-health?var-release=tyrum-core
- Prometheus (direct query UI): https://prometheus.staging.tyrum.run/graph?g0.expr=up&g0.tab=1
- Loki log explorer: https://grafana.staging.tyrum.run/explore?left=%5B%22now-1h%22,%22now%22,%22Loki%22,%7B%22expr%22:%7B%22expr%22:%7B%7D%7D%7D%5D
- PagerDuty service (Tyrum Staging Control Plane):
  https://virtunet.pagerduty.com/service-directory/TYRUM-STAGING
- Slack escalation channel: https://app.slack.com/client/TYRUM/tyrum-staging-ops

For air-gapped troubleshooting, port-forwarding remains available:
```bash
kubectl -n observability port-forward svc/grafana 3001:3000
open http://localhost:3001/d/tyrum-control-plane/overview?var-environment=staging
```
