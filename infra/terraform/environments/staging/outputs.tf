output "vpc_id" {
  description = "Identifier for the staging VPC."
  value       = module.network.vpc_id
}

output "private_subnet_ids" {
  description = "Private subnet IDs hosting the Kubernetes worker nodes."
  value       = module.network.private_subnets
}

output "public_subnet_ids" {
  description = "Public subnet IDs for load balancers and ingress controllers."
  value       = module.network.public_subnets
}

output "eks_cluster_name" {
  description = "Name of the EKS cluster."
  value       = module.eks.cluster_name
}

output "eks_cluster_endpoint" {
  description = "API server endpoint for the EKS cluster."
  value       = module.eks.cluster_endpoint
}

output "secrets_manager_arns" {
  description = "Secrets Manager ARNs provisioned for staging."
  value = {
    platform_config   = aws_secretsmanager_secret.platform_config.arn
    cluster_bootstrap = aws_secretsmanager_secret.cluster_bootstrap.arn
  }
}
