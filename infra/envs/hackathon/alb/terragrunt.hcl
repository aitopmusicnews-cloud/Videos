include "root" {
  path = find_in_parent_folders("terragrunt.hcl")
}

locals {
  env = read_terragrunt_config(find_in_parent_folders("env.hcl")).locals
}

terraform {
  source = "../../../modules/alb"
}

dependency "networking" {
  config_path = "../networking"
  mock_outputs = {
    vpc_id            = "vpc-mock"
    public_subnet_ids = ["subnet-mock-a", "subnet-mock-b"]
  }
}

inputs = {
  environment       = local.env.environment
  vpc_id            = dependency.networking.outputs.vpc_id
  public_subnet_ids = dependency.networking.outputs.public_subnet_ids
  api_port          = local.env.api_port
}
