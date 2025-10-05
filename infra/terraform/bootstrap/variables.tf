variable "environment" {
  type        = string
  description = "Deployment environment (e.g. staging)."
  default     = "staging"
}

variable "aws_region" {
  type        = string
  description = "AWS region for bootstrap resources."
  default     = "eu-west-1"
}

variable "aws_profile" {
  type        = string
  description = "Named AWS CLI profile that has permissions to create foundational resources."
  default     = "virtunet-staging"
}

variable "state_bucket_name" {
  type        = string
  description = "S3 bucket name for Terraform remote state."
  default     = "tyrum-staging-terraform-state"
}

variable "state_lock_table_name" {
  type        = string
  description = "DynamoDB table used for Terraform state locking."
  default     = "tyrum-terraform-locks"
}
