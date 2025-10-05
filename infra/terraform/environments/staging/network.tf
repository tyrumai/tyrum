module "network" {
  source  = "terraform-aws-modules/vpc/aws"
  version = "5.1.2"

  name = "${local.name_prefix}-core"
  cidr = var.vpc_cidr
  azs  = var.availability_zones

  private_subnets = [
    for idx, az in var.availability_zones :
    cidrsubnet(var.vpc_cidr, 4, idx)
  ]

  public_subnets = [
    for idx, az in var.availability_zones :
    cidrsubnet(var.vpc_cidr, 4, idx + 8)
  ]

  enable_nat_gateway            = true
  single_nat_gateway            = true
  enable_dns_hostnames          = true
  enable_dns_support            = true
  map_public_ip_on_launch       = false
  create_igw                    = true
  manage_default_security_group = true

  default_security_group_ingress = [{
    description = "Allow node-to-node"
    protocol    = "-1"
    from_port   = 0
    to_port     = 0
    cidr_blocks = var.vpc_cidr
  }]

  default_security_group_egress = [{
    description = "Allow all outbound"
    protocol    = "-1"
    from_port   = 0
    to_port     = 0
    cidr_blocks = "0.0.0.0/0"
  }]

  enable_flow_log                                 = true
  flow_log_destination_type                       = "cloud-watch-logs"
  create_flow_log_cloudwatch_log_group            = true
  create_flow_log_cloudwatch_iam_role             = true
  flow_log_cloudwatch_log_group_name_prefix       = "/aws/vpc/"
  flow_log_cloudwatch_log_group_name_suffix       = local.name_prefix
  flow_log_cloudwatch_log_group_retention_in_days = 90

  tags                = local.tags
  vpc_tags            = local.tags
  public_subnet_tags  = merge(local.tags, { Tier = "public" })
  private_subnet_tags = merge(local.tags, { Tier = "private" })
}
