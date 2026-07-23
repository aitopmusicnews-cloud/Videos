variable "project" { type = string }
variable "environment" { type = string }
variable "region" { type = string }

locals {
  bucket_name = "${var.project}-${var.environment}-storage"
}

resource "aws_s3_bucket" "storage" {
  bucket        = local.bucket_name
  force_destroy = true
}

# Only uploads/ and renders/ are public — those are the assets the frontend
# and Runway need to fetch directly. Everything else (projects/clips/images
# metadata JSON, analyses cache, render manifests) is server-only; the API
# task role reads it via its IAM creds.
resource "aws_s3_bucket_public_access_block" "storage" {
  bucket = aws_s3_bucket.storage.id

  # ACLs stay blocked; we only allow public GetObject via bucket policy on
  # specific prefixes below.
  block_public_acls       = true
  ignore_public_acls      = true
  block_public_policy     = false
  restrict_public_buckets = false
}

resource "aws_s3_bucket_ownership_controls" "storage" {
  bucket = aws_s3_bucket.storage.id
  rule {
    object_ownership = "BucketOwnerEnforced"
  }
}

resource "aws_s3_bucket_policy" "public_read" {
  bucket     = aws_s3_bucket.storage.id
  depends_on = [aws_s3_bucket_public_access_block.storage]

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid       = "PublicReadAssets"
        Effect    = "Allow"
        Principal = "*"
        Action    = "s3:GetObject"
        Resource = [
          "${aws_s3_bucket.storage.arn}/uploads/*",
          "${aws_s3_bucket.storage.arn}/renders/*",
        ]
      }
    ]
  })
}

resource "aws_s3_bucket_cors_configuration" "storage" {
  bucket = aws_s3_bucket.storage.id

  cors_rule {
    allowed_headers = ["*"]
    allowed_methods = ["GET", "HEAD"]
    allowed_origins = ["*"]
    expose_headers  = ["ETag", "Content-Length", "Content-Type"]
    max_age_seconds = 3600
  }
}

# Auto-purge anything older than 30 days. Hackathon storage is cheap to
# regenerate; cap the bill if a project goes idle.
resource "aws_s3_bucket_lifecycle_configuration" "storage" {
  bucket = aws_s3_bucket.storage.id

  rule {
    id     = "expire-after-30d"
    status = "Enabled"

    filter {}

    expiration {
      days = 30
    }
  }
}

output "bucket_name" {
  value = aws_s3_bucket.storage.id
}

output "bucket_arn" {
  value = aws_s3_bucket.storage.arn
}

output "public_url_base" {
  value = "https://${aws_s3_bucket.storage.id}.s3.${var.region}.amazonaws.com"
}
