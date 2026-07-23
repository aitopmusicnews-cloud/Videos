# Root Terragrunt config — applies to every leaf stack via `include "root"`.
#
# State backend: S3 + DynamoDB (locking). The bucket and table are
# bootstrapped out-of-band:
#   aws s3api create-bucket --bucket music-video-studio-tfstate ...
#   aws dynamodb create-table --table-name music-video-studio-tflock ...

locals {
  project = "music-video-studio"
  region  = "us-west-2"
}

generate "provider" {
  path      = "_provider.tf"
  if_exists = "overwrite_terragrunt"
  contents  = <<EOF
terraform {
  required_version = ">= 1.5"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.70"
    }
  }
}

provider "aws" {
  region = "${local.region}"
  default_tags {
    tags = {
      Project     = "${local.project}"
      ManagedBy   = "terragrunt"
    }
  }
}
EOF
}

remote_state {
  backend = "s3"
  generate = {
    path      = "_backend.tf"
    if_exists = "overwrite_terragrunt"
  }
  config = {
    bucket         = "music-video-studio-tfstate"
    key            = "${path_relative_to_include()}/terraform.tfstate"
    region         = local.region
    encrypt        = true
    dynamodb_table = "music-video-studio-tflock"
  }
}

inputs = {
  project = local.project
  region  = local.region
}
