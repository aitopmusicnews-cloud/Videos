variable "project" { type = string }
variable "environment" { type = string }
variable "region" { type = string }
variable "repo_name" { type = string }

resource "aws_ecr_repository" "api" {
  name                 = var.repo_name
  image_tag_mutability = "MUTABLE"
  force_delete         = true

  image_scanning_configuration {
    scan_on_push = true
  }
}

resource "aws_ecr_lifecycle_policy" "api" {
  repository = aws_ecr_repository.api.name

  policy = jsonencode({
    rules = [
      {
        rulePriority = 1
        description  = "keep last 10 images"
        selection = {
          tagStatus   = "any"
          countType   = "imageCountMoreThan"
          countNumber = 10
        }
        action = { type = "expire" }
      }
    ]
  })
}

output "repository_url" {
  value = aws_ecr_repository.api.repository_url
}

output "repository_name" {
  value = aws_ecr_repository.api.name
}
