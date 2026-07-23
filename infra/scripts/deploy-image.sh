#!/usr/bin/env bash
# Build + push to ECR, then force a new ECS deployment.
#
# Use this for normal pushes after the stack is up. For the very first push
# (before the ECS service exists), use bootstrap-ecr.sh instead.
#
# Usage: infra/scripts/deploy-image.sh [tag]
#   tag defaults to "latest"

set -euo pipefail

TAG="${1:-latest}"
PROJECT="music-video-studio"
ENVIRONMENT="hackathon"
REGION="us-west-2"

# Reuse the bootstrap path for build + push.
"$(dirname "$0")/bootstrap-ecr.sh" "${TAG}"

echo ">>> force ecs redeploy"
aws ecs update-service \
  --cluster "${PROJECT}-${ENVIRONMENT}" \
  --service "${PROJECT}-${ENVIRONMENT}-api" \
  --force-new-deployment \
  --region "${REGION}" \
  --output text \
  --query 'service.deployments[0].rolloutState' \
  > /dev/null

# Bust CloudFront's edge caches so users pick up the new SPA bundle on
# their next visit. We tag the distribution with `Comment = "<project>-<env>"`
# in the cloudfront module, so that's what we filter on here.
DIST_ID=$(aws cloudfront list-distributions \
  --query "DistributionList.Items[?Comment=='${PROJECT}-${ENVIRONMENT}'].Id | [0]" \
  --output text 2>/dev/null || true)
if [ -n "${DIST_ID}" ] && [ "${DIST_ID}" != "None" ]; then
  echo ">>> invalidating CloudFront ${DIST_ID}"
  aws cloudfront create-invalidation \
    --distribution-id "${DIST_ID}" \
    --paths '/*' \
    --output text --query 'Invalidation.Id' >/dev/null
fi

echo ">>> deployed"
