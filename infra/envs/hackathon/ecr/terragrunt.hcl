include "root" {
  path = find_in_parent_folders("terragrunt.hcl")
}

locals {
  env = read_terragrunt_config(find_in_parent_folders("env.hcl")).locals
}

terraform {
  source = "../../../modules/ecr"
}

inputs = {
  environment = local.env.environment
  repo_name   = "music-video-studio-api"
}
