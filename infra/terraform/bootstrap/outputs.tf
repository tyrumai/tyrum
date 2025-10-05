output "state_bucket" {
  description = "Name of the S3 bucket storing Terraform state."
  value       = aws_s3_bucket.terraform_state.id
}

output "state_lock_table" {
  description = "Name of the DynamoDB table used for Terraform state locking."
  value       = aws_dynamodb_table.terraform_state_locks.name
}
