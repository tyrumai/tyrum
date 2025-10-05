resource "aws_kms_key" "secrets" {
  description             = "tyrum staging secrets"
  deletion_window_in_days = 7
  enable_key_rotation     = true

  tags = merge(local.tags, {
    Purpose = "secrets-encryption"
  })
}

resource "aws_kms_alias" "secrets" {
  name          = "alias/${local.name_prefix}-secrets"
  target_key_id = aws_kms_key.secrets.id
}

resource "aws_secretsmanager_secret" "platform_config" {
  name        = "${local.name_prefix}/platform/config"
  description = "Baseline configuration envelope for staging services."
  kms_key_id  = aws_kms_key.secrets.arn

  tags = merge(local.tags, {
    Purpose = "platform-config"
  })
}

resource "aws_secretsmanager_secret" "cluster_bootstrap" {
  name        = "${local.name_prefix}/cluster/bootstrap"
  description = "Kubernetes bootstrap credentials (created post-apply)."
  kms_key_id  = aws_kms_key.secrets.arn

  tags = merge(local.tags, {
    Purpose = "cluster-bootstrap"
  })
}
