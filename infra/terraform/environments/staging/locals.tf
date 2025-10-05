locals {
  name_prefix = "tyrum-${var.environment}"

  tags = {
    Environment = var.environment
    Project     = "tyrum"
    ManagedBy   = "terraform"
  }
}
