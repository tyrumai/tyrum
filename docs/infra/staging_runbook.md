# Staging Infrastructure Runbook

This runbook captures the day-one operational procedures for Tyrum's staging
environment. It covers Terraform-driven infrastructure updates, Helm-based
application rollouts, rollback mechanics, and secret rotations, plus links to
observability dashboards and alerting paths required for readiness checks.

## Access & Prerequisites
- Terraform 1.8+, Helm 3.9+, kubectl 1.30+, the AWS CLI, and `jq` must be installed.
- Log in with the staging profile: `aws sso login --profile virtunet-staging`.
- Export the profile before invoking Terraform or kubectl:
  ```bash
  export AWS_PROFILE=virtunet-staging
  ```
- Terraform state lives in `s3://tyrum-staging-terraform-state` with
  DynamoDB locking (`tyrum-terraform-locks`). Never edit the state file by
  hand.
- Ensure you have bastion/VPN access to the staging VPC for private endpoints
  and that your machine's SSH key is registered with the infra team.

## Terraform Apply (Staging)
1. Change to the environment directory:
   ```bash
   cd infra/terraform/environments/staging
   ```
2. Initialise providers and backends if this is a fresh checkout:
   ```bash
   terraform init
   ```
3. Create a plan and persist it for peer review (attach the file and summary to
   the issue or PR):
   ```bash
   terraform plan -out plan.tfplan
   terraform show -json plan.tfplan | jq '.'
   ```
4. Apply the reviewed plan only after confirming the diff:
   ```bash
   terraform apply plan.tfplan
   ```
5. Post-apply verification:
   - Capture outputs for the run log:
     ```bash
     terraform output -json > ../../../../artifacts/staging-$(date +%Y%m%d%H%M%S)-outputs.json
     ```
   - Update kubeconfig and confirm the cluster is reachable:
     ```bash
     aws eks update-kubeconfig --name tyrum-staging-eks --region eu-west-1
     kubectl get nodes -o wide
     ```
   - Check Secrets Manager envelopes referenced by the outputs exist and are in
     `Enabled` rotation status:
     ```bash
     aws secretsmanager describe-secret --secret-id tyrum-staging/platform/config
     ```
6. If the plan introduces networking changes, validate the staging endpoints:
   ```bash
   aws ec2 describe-vpcs --vpc-ids $(terraform output -raw vpc_id)
   kubectl get svc --namespace tyrum-core
   ```

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
   helm test tyrum-core --namespace tyrum-core
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

### Terraform Rollback / Drift Repair
- Revert the Terraform configuration to the previous commit (or cherry-pick the
  last known good state) and re-run `terraform plan` to ensure the diff is empty.
- If an unsafe resource change was applied (e.g. VPC deletion), open a high
  severity incident in `#tyrum-staging-ops` and coordinate manual remediation
  with the infra lead before touching state.
- For fast rollback of simple values (e.g. ASG counts), prefer applying the
  previous plan file you captured before the change:
  ```bash
  terraform apply previous-plan.tfplan
  ```

## Secret Rotation
Staging secrets are managed in AWS Secrets Manager and projected into the
cluster by the Helm chart.

1. Identify the secret to rotate from Terraform outputs (`platform_config` or
   `cluster_bootstrap`).
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
