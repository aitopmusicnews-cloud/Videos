variable "project" { type = string }
variable "environment" { type = string }
variable "region" { type = string }
variable "api_port" { type = number }
variable "image_tag" { type = string }
variable "vpc_id" { type = string }
variable "public_subnet_ids" { type = list(string) }
variable "repository_url" { type = string }
variable "target_group_arn" { type = string }
variable "alb_sg_id" { type = string }
variable "alb_dns_name" { type = string }
variable "cluster_name" { type = string }
variable "cluster_id" { type = string }
variable "s3_bucket_name" { type = string }
variable "s3_bucket_arn" { type = string }
variable "s3_public_url" { type = string }
# The CloudFront distribution that fronts the ALB. Empty until the cloudfront
# stack has been applied; the api falls back to ALB-only CORS in that case.
variable "cloudfront_domain" {
  type    = string
  default = ""
}

# Secrets/keys are read from SSM Parameter Store. Create these out-of-band:
#   aws ssm put-parameter --name /music-video-studio/hackathon/RUNWAYML_API_SECRET --value '...' --type SecureString
#   aws ssm put-parameter --name /music-video-studio/hackathon/MODAL_AUDIO_URL --value '...' --type String
data "aws_caller_identity" "current" {}

locals {
  ssm_prefix = "/${var.project}/${var.environment}"
  log_group  = "/ecs/${var.project}-${var.environment}"
  family     = "${var.project}-${var.environment}-api"
}

resource "aws_cloudwatch_log_group" "api" {
  name              = local.log_group
  retention_in_days = 7
}

# Task execution role: ECS pulls the image, writes logs, reads SSM.
resource "aws_iam_role" "task_execution" {
  name = "${local.family}-exec"
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "ecs-tasks.amazonaws.com" }
      Action    = "sts:AssumeRole"
    }]
  })
}

resource "aws_iam_role_policy_attachment" "task_execution_managed" {
  role       = aws_iam_role.task_execution.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"
}

resource "aws_iam_role_policy" "task_execution_ssm" {
  name = "ssm-read"
  role = aws_iam_role.task_execution.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = ["ssm:GetParameters"]
        Resource = [
          "arn:aws:ssm:${var.region}:${data.aws_caller_identity.current.account_id}:parameter${local.ssm_prefix}/*"
        ]
      },
      {
        # KMS Decrypt is required to read SecureString parameters. The default
        # SSM key (alias/aws/ssm) doesn't accept a tight resource ARN here, so
        # we leave the resource wildcard but scope the action to Decrypt only.
        Effect   = "Allow"
        Action   = ["kms:Decrypt"]
        Resource = "*"
      }
    ]
  })
}

# Task role: app-level AWS perms. Carries S3 access for upload/render writes.
resource "aws_iam_role" "task" {
  name = "${local.family}-task"
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "ecs-tasks.amazonaws.com" }
      Action    = "sts:AssumeRole"
    }]
  })
}

resource "aws_iam_role_policy" "task_s3" {
  name = "s3-storage"
  role = aws_iam_role.task.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = ["s3:PutObject", "s3:GetObject", "s3:DeleteObject", "s3:HeadObject"]
        Resource = "${var.s3_bucket_arn}/*"
      },
      {
        Effect = "Allow"
        Action = ["s3:ListBucket"]
        Resource = var.s3_bucket_arn
      }
    ]
  })
}

resource "aws_security_group" "task" {
  name        = "${local.family}-task"
  description = "ingress from ALB only"
  vpc_id      = var.vpc_id

  ingress {
    from_port       = var.api_port
    to_port         = var.api_port
    protocol        = "tcp"
    security_groups = [var.alb_sg_id]
    description     = "from alb"
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }
}

resource "aws_ecs_task_definition" "api" {
  family                   = local.family
  # 2 vCPU / 4 GB. libx264 scales linearly to 2 threads so render wall-clock
  # roughly halves vs. 1 vCPU, with comfortable memory headroom for the
  # decoder buffers a 20+ clip timeline keeps in flight. Cost delta is ~$0.05/hr
  # ($0.05 → $0.10) which is a fine trade for hackathon-shaped workloads.
  cpu                      = "2048"
  memory                   = "4096"
  network_mode             = "awsvpc"
  requires_compatibilities = ["FARGATE"]
  execution_role_arn       = aws_iam_role.task_execution.arn
  task_role_arn            = aws_iam_role.task.arn

  container_definitions = jsonencode([
    {
      name      = "api"
      image     = "${var.repository_url}:${var.image_tag}"
      essential = true
      portMappings = [
        { containerPort = var.api_port, protocol = "tcp" }
      ]
      environment = [
        { name = "PORT", value = tostring(var.api_port) },
        # PUBLIC_BASE_URL stays on the ALB so backend-to-backend fetches
        # (Modal/Runway pulling from /storage) bypass CloudFront's basic auth.
        { name = "PUBLIC_BASE_URL", value = "http://${var.alb_dns_name}" },
        # WEB_ORIGIN accepts a comma-separated list. We always allow the ALB
        # origin (lets you smoke-test via the ALB DNS) and append the
        # CloudFront domain when it's known.
        {
          name  = "WEB_ORIGIN"
          value = var.cloudfront_domain == "" ? (
            "http://${var.alb_dns_name}"
            ) : (
            "http://${var.alb_dns_name},https://${var.cloudfront_domain}"
          )
        },
        { name = "STORAGE_DIR", value = "/app/storage" },
        { name = "STORAGE_BACKEND", value = "s3" },
        { name = "S3_BUCKET", value = var.s3_bucket_name },
        { name = "S3_REGION", value = var.region },
        { name = "S3_PUBLIC_URL_BASE", value = var.s3_public_url }
      ]
      secrets = [
        {
          name      = "RUNWAYML_API_SECRET"
          valueFrom = "arn:aws:ssm:${var.region}:${data.aws_caller_identity.current.account_id}:parameter${local.ssm_prefix}/RUNWAYML_API_SECRET"
        },
        {
          name      = "MODAL_AUDIO_URL"
          valueFrom = "arn:aws:ssm:${var.region}:${data.aws_caller_identity.current.account_id}:parameter${local.ssm_prefix}/MODAL_AUDIO_URL"
        }
      ]
      logConfiguration = {
        logDriver = "awslogs"
        options = {
          awslogs-group         = aws_cloudwatch_log_group.api.name
          awslogs-region        = var.region
          awslogs-stream-prefix = "api"
        }
      }
    }
  ])
}

resource "aws_ecs_service" "api" {
  name             = "${local.family}"
  cluster          = var.cluster_id
  task_definition  = aws_ecs_task_definition.api.arn
  desired_count    = 1
  launch_type      = "FARGATE"
  platform_version = "LATEST"

  network_configuration {
    subnets          = var.public_subnet_ids
    security_groups  = [aws_security_group.task.id]
    assign_public_ip = true
  }

  load_balancer {
    target_group_arn = var.target_group_arn
    container_name   = "api"
    container_port   = var.api_port
  }

  deployment_minimum_healthy_percent = 0
  deployment_maximum_percent         = 200

  lifecycle {
    ignore_changes = [task_definition] # let `aws ecs update-service` drive deploys
  }
}

output "service_name" {
  value = aws_ecs_service.api.name
}

output "task_definition_arn" {
  value = aws_ecs_task_definition.api.arn
}

output "log_group" {
  value = aws_cloudwatch_log_group.api.name
}

output "url" {
  value = "http://${var.alb_dns_name}"
}
