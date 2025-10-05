variable "environment" {
  type        = string
  description = "Deployment environment identifier (e.g. staging)."
  default     = "staging"
}

variable "aws_region" {
  type        = string
  description = "AWS region to deploy into."
  default     = "eu-west-1"
}

variable "aws_profile" {
  type        = string
  description = "Named AWS config profile."
  default     = "virtunet-staging"
}

variable "vpc_cidr" {
  type        = string
  description = "CIDR block for the staging VPC."
  default     = "10.20.0.0/16"
}

variable "availability_zones" {
  type        = list(string)
  description = "Availability zones to spread subnets across."
  default = [
    "eu-west-1a",
    "eu-west-1b",
    "eu-west-1c"
  ]
}

variable "cluster_version" {
  type        = string
  description = "Kubernetes version for the EKS control plane."
  default     = "1.30"
}

variable "eks_desired_size" {
  type        = number
  description = "Desired node count for the default managed node group."
  default     = 3
}

variable "eks_min_size" {
  type        = number
  description = "Minimum node count for the default managed node group."
  default     = 2
}

variable "eks_max_size" {
  type        = number
  description = "Maximum node count for the default managed node group."
  default     = 6
}

variable "eks_instance_types" {
  type        = list(string)
  description = "Instance types backing the default node group."
  default     = ["m7g.large"]
}

