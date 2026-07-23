#!/usr/bin/env bash
# Build and push the API image to ECR — without touching the ECS service.
#
# Use this for the very first apply, where the service stack would otherwise
# fail because no image exists at <repo>:latest yet:
#
#   1. terragrunt -working-dir infra/envs/hackathon/networking apply
#   2. terragrunt -working-dir infra/envs/hackathon/ecr apply
#   3. infra/scripts/bootstrap-ecr.sh
#   4. cd infra/envs/hackathon && terragrunt run-all apply   # service now finds the image
#
# After bootstrap, use deploy-image.sh for normal pushes (it also force-redeploys ECS).
#
# Usage: infra/scripts/bootstrap-ecr.sh [tag]
#   tag defaults to "latest"

set -euo pipefail

TAG="${1:-latest}"
PROJECT="music-video-studio"
REGION="us-west-2"
REPO="${PROJECT}-api"

ACCOUNT=$(aws sts get-caller-identity --query Account --output text)
ECR_HOST="${ACCOUNT}.dkr.ecr.${REGION}.amazonaws.com"
IMAGE="${ECR_HOST}/${REPO}:${TAG}"

cd "$(dirname "$0")/../.."

# Sanity-check that the ECR repo actually exists. Fail early with a useful
# message rather than letting docker push spew an opaque auth error.
if ! aws ecr describe-repositories --repository-names "${REPO}" --region "${REGION}" >/dev/null 2>&1; then
  echo "ERROR: ECR repo '${REPO}' not found in ${REGION}." >&2
  echo "Run 'terragrunt apply' on infra/envs/hackathon/ecr first." >&2
  exit 1
fi

echo ">>> docker build → ${IMAGE}"
docker build --platform linux/amd64 -f apps/api/Dockerfile -t "${IMAGE}" .

echo ">>> aws ecr login"
aws ecr get-login-password --region "${REGION}" | \
  docker login --username AWS --password-stdin "${ECR_HOST}"

echo ">>> docker push"
docker push "${IMAGE}"

echo ">>> bootstrapped ${IMAGE}"
echo "    next: cd infra/envs/hackathon && terragrunt run-all apply"
