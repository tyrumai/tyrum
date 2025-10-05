provider "aws" {
  region  = var.aws_region
  profile = var.aws_profile

  default_tags {
    tags = {
      Environment = var.environment
      Project     = "tyrum"
      ManagedBy   = "terraform"
    }
  }
}
