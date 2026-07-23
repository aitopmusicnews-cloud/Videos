variable "project" { type = string }
variable "environment" { type = string }
variable "region" { type = string }
variable "alb_dns_name" { type = string }

# Basic auth credentials live in SSM Parameter Store. Set them out-of-band
# before applying this stack:
#
#   aws ssm put-parameter --name /music-video-studio/hackathon/BASIC_AUTH_USERNAME \
#     --value 'mvs' --type String --region us-west-2
#
#   aws ssm put-parameter --name /music-video-studio/hackathon/BASIC_AUTH_PASSWORD \
#     --value 'strong-pw' --type SecureString --region us-west-2
#
# Rotation: update the SSM parameters and re-apply terragrunt. The
# CloudFront Function is republished with the new base64 credential.
data "aws_ssm_parameter" "basic_auth_username" {
  name            = "/${var.project}/${var.environment}/BASIC_AUTH_USERNAME"
  with_decryption = true
}

data "aws_ssm_parameter" "basic_auth_password" {
  name            = "/${var.project}/${var.environment}/BASIC_AUTH_PASSWORD"
  with_decryption = true
}

# Pre-compute base64("user:pass") at apply time so the function does a single
# constant-time-ish equality check rather than parsing the header.
locals {
  basic_auth_b64 = base64encode(
    "${data.aws_ssm_parameter.basic_auth_username.value}:${data.aws_ssm_parameter.basic_auth_password.value}"
  )
}

# Viewer-request function: gates everything except /storage/* (so backend-to-
# backend fetches by Modal/Runway can hit storage URLs without the auth
# challenge — those URLs are sha256-prefixed and not enumerable). Returns
# 401 with WWW-Authenticate when the header is missing or wrong; otherwise
# lets the request continue to the origin.
resource "aws_cloudfront_function" "basic_auth" {
  name    = "${var.project}-${var.environment}-basic-auth"
  runtime = "cloudfront-js-2.0"
  comment = "Basic Auth on viewer requests; bypasses /storage/*."
  publish = true
  code    = <<-EOT
    function handler(event) {
      var request = event.request;
      var uri = request.uri || "";
      if (uri.indexOf("/storage/") === 0) {
        return request;
      }
      var expected = "Basic ${local.basic_auth_b64}";
      var auth = request.headers.authorization;
      if (!auth || auth.value !== expected) {
        return {
          statusCode: 401,
          statusDescription: "Unauthorized",
          headers: {
            "www-authenticate": { value: "Basic realm=\"Music Video Studio\"" },
          },
        };
      }
      return request;
    }
  EOT
}

# Custom origin pointing at the existing ALB. Viewers → CloudFront on HTTPS;
# CloudFront → ALB on HTTP 80. The ALB stays publicly reachable at its own
# DNS for backend-to-backend traffic that needs to bypass auth.
resource "aws_cloudfront_distribution" "this" {
  enabled             = true
  is_ipv6_enabled     = true
  comment             = "${var.project}-${var.environment}"
  default_root_object = "index.html"
  price_class         = "PriceClass_100"

  origin {
    domain_name = var.alb_dns_name
    origin_id   = "alb"

    custom_origin_config {
      http_port              = 80
      https_port             = 443
      origin_protocol_policy = "http-only"
      origin_ssl_protocols   = ["TLSv1.2"]
    }
  }

  default_cache_behavior {
    target_origin_id       = "alb"
    viewer_protocol_policy = "redirect-to-https"
    allowed_methods        = ["GET", "HEAD", "OPTIONS", "PUT", "POST", "PATCH", "DELETE"]
    cached_methods         = ["GET", "HEAD"]
    compress               = true

    # AWS managed CachingDisabled — the API and SPA index are dynamic-ish for
    # now. Tune later if static asset caching becomes important.
    cache_policy_id          = "4135ea2d-6df8-44a3-9df3-4b5a84be39ad"
    origin_request_policy_id = "216adef6-5c7f-47e4-b989-5492eafa07d3" # AllViewer

    function_association {
      event_type   = "viewer-request"
      function_arn = aws_cloudfront_function.basic_auth.arn
    }
  }

  # Storage assets bypass auth (the function checks first, but having an
  # explicit behavior here makes the routing intent clear in the console).
  ordered_cache_behavior {
    path_pattern             = "/storage/*"
    target_origin_id         = "alb"
    viewer_protocol_policy   = "redirect-to-https"
    allowed_methods          = ["GET", "HEAD", "OPTIONS"]
    cached_methods           = ["GET", "HEAD"]
    compress                 = true
    cache_policy_id          = "658327ea-f89d-4fab-a63d-7e88639e58f6" # CachingOptimized
    origin_request_policy_id = "216adef6-5c7f-47e4-b989-5492eafa07d3" # AllViewer
  }

  restrictions {
    geo_restriction {
      restriction_type = "none"
    }
  }

  viewer_certificate {
    cloudfront_default_certificate = true
  }
}

output "domain_name" {
  value = aws_cloudfront_distribution.this.domain_name
}

output "distribution_id" {
  value = aws_cloudfront_distribution.this.id
}

output "url" {
  value = "https://${aws_cloudfront_distribution.this.domain_name}"
}
