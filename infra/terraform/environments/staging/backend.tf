terraform {
  backend "s3" {
    bucket         = "tyrum-staging-terraform-state"
    key            = "environments/staging/terraform.tfstate"
    region         = "eu-west-1"
    dynamodb_table = "tyrum-terraform-locks"
    encrypt        = true
  }
}
