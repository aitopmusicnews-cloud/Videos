variable "project" { type = string }
variable "environment" { type = string }
variable "region" { type = string }

# Use the account's default VPC and public subnets. No NAT gateway costs,
# no extra networking to manage. Fine for a hackathon weekend; replace with
# a dedicated VPC module if this graduates beyond that.

data "aws_vpc" "default" {
  default = true
}

data "aws_subnets" "public" {
  filter {
    name   = "vpc-id"
    values = [data.aws_vpc.default.id]
  }
  filter {
    name   = "default-for-az"
    values = ["true"]
  }
}

output "vpc_id" {
  value = data.aws_vpc.default.id
}

output "public_subnet_ids" {
  value = data.aws_subnets.public.ids
}
