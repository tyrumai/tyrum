# Terraform Baseline

This stack provisions the staging infrastructure called out in `docs/product_concept_v1.md`:\
- `infra/terraform/bootstrap` creates the remote state bucket and DynamoDB lock table.
- `infra/terraform/environments/staging` provisions the VPC, EKS cluster, and Secrets Manager envelopes.

## Prerequisites
- Terraform 1.8+
- AWS credentials with permissions to create VPC, EKS, KMS, Secrets Manager, S3, and DynamoDB resources. Use the `virtunet-staging` named profile or override `var.aws_profile`.
- `aws` CLI configured with MFA/session guards per the infra team guidelines.

## Remote State Bootstrap
Run this once per account to guarantee the backend exists before switching to the staged stack.

```bash
cd infra/terraform/bootstrap
terraform init
terraform apply -auto-approve \
  -var="aws_profile=virtunet-staging" \
  -var="state_bucket_name=tyrum-staging-terraform-state" \
  -var="state_lock_table_name=tyrum-terraform-locks"
```

The outputs confirm the bucket and lock table names. They must match the backend stanza in `environments/staging/backend.tf`.

## Staging Environment Deploy
After the backend exists, run the staged plan/apply cycle:

```bash
cd infra/terraform/environments/staging
export AWS_PROFILE=virtunet-staging
terraform init
terraform plan -out plan.tfplan
terraform apply plan.tfplan
```

Key resources:
- `module.network` builds the `tyrum-staging-core` VPC with public/private subnets and flow logs.
- `module.eks` deploys an EKS 1.30 control plane plus an ARM-based managed node group sized for baseline workloads.
- `aws_secretsmanager_secret` resources create placeholders for platform configuration and cluster bootstrap material, encrypted by the `aws_kms_key.secrets` CMK.

All resources are tagged with `Environment=staging`, `Project=tyrum`, and `ManagedBy=terraform` to line up with FinOps and guardrail queries.

## Post-Apply Verification
1. Confirm `terraform output` surfaces VPC IDs, subnet IDs, cluster endpoint, and secrets ARNs. Attach the output to the issue when capturing evidence.
2. Use `aws eks update-kubeconfig --name tyrum-staging-eks --region eu-west-1` to obtain kubeconfig credentials, then deploy the baseline namespaces/Helm charts from the M0 follow-up issues (see `docs/infra/helm.md` for the deployment runbook).
3. Manage additional cluster access either via IAM identity mappings in the `aws-auth` ConfigMap or EKS access entries; capture those mappings in follow-up issues to keep drift visible.

## State & Access Notes
- State lives in `s3://tyrum-staging-terraform-state/environments/staging/terraform.tfstate` with DynamoDB locking (`tyrum-terraform-locks`).
- Never edit state by hand; rely on `terraform state` commands when refactoring.
- For ephemeral experiments create a dedicated workspace or directory instead of hijacking staging.
