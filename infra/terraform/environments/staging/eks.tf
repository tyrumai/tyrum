module "eks" {
  source  = "terraform-aws-modules/eks/aws"
  version = "20.28.0"

  cluster_name                    = "${local.name_prefix}-eks"
  cluster_version                 = var.cluster_version
  cluster_endpoint_public_access  = true
  cluster_endpoint_private_access = true

  enable_irsa = true

  vpc_id     = module.network.vpc_id
  subnet_ids = module.network.private_subnets

  cluster_tags = local.tags
  tags         = local.tags

  eks_managed_node_groups = {
    default = {
      ami_type       = "AL2_ARM_64"
      instance_types = var.eks_instance_types
      desired_size   = var.eks_desired_size
      min_size       = var.eks_min_size
      max_size       = var.eks_max_size
      capacity_type  = "ON_DEMAND"
      labels = {
        workload = "general"
      }
      tags = merge(local.tags, {
        Name = "${local.name_prefix}-workers"
      })
    }
  }

  cluster_addons = {
    coredns = {
      most_recent = true
    }
    kube-proxy = {
      most_recent = true
    }
    vpc-cni = {
      most_recent = true
    }
  }
}
