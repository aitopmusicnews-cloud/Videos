include "root" {
  path = find_in_parent_folders("terragrunt.hcl")
}

locals {
  env = read_terragrunt_config(find_in_parent_folders("env.hcl")).locals
}

terraform {
  source = "../../../modules/cloudfront"
}

dependency "alb" {
  config_path = "../alb"
  mock_outputs = {
    alb_dns_name = "mock.us-west-2.elb.amazonaws.com"
  }
}

# Basic auth credentials are read from SSM at apply time. Provision them
# out-of-band before applying this stack:
#
#   aws ssm put-parameter --name /music-video-studio/hackathon/BASIC_AUTH_USERNAME \
#     --value 'mvs' --type String --region us-west-2
#
#   aws ssm put-parameter --name /music-video-studio/hackathon/BASIC_AUTH_PASSWORD \
#     --value 'strong-password-here' --type SecureString --region us-west-2
#
# Rotation: update the SSM params, re-apply terragrunt. The CloudFront
# Function gets republished with the new base64 credential.
inputs = {
  environment  = local.env.environment
  alb_dns_name = dependency.alb.outputs.alb_dns_name
}
