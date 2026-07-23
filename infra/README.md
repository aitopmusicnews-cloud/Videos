# Infrastructure

Terragrunt + Terraform for the Fargate stack.

## Layout

```
infra/
  terragrunt.hcl                 # root: provider + state backend
  envs/hackathon/
    env.hcl                      # env-level inputs (project name, image tag, port)
    networking/                  # default VPC + public subnets (data sources only)
    ecr/                         # music-video-studio-api repo
    alb/                         # ALB + target group + HTTP listener
    cluster/                     # ECS Fargate cluster
    storage/                     # S3 bucket for uploads + renders (public-read)
    service/                     # task definition, service, IAM, logs, SG
    cloudfront/                  # CloudFront in front of ALB + Basic Auth function
  modules/                       # the actual Terraform
  scripts/
    bootstrap-ecr.sh             # build + push first image (no service redeploy)
    deploy-image.sh              # build + push + force redeploy
```

## Prereqs

- AWS CLI configured (`aws sts get-caller-identity` returns an account)
- `terragrunt` and `terraform` on PATH
- Docker for image builds

## Bootstrap

One-time secrets in SSM Parameter Store. The task definition + CloudFront
function read from these.

```bash
aws ssm put-parameter --name /music-video-studio/hackathon/RUNWAYML_API_SECRET \
  --value 'key_...' --type SecureString --region us-west-2

aws ssm put-parameter --name /music-video-studio/hackathon/MODAL_AUDIO_URL \
  --value 'https://...modal.run' --type String --region us-west-2

# Basic Auth gate at the CloudFront edge. Username can be anything; pick a
# strong password — it's the only thing standing between the open web and
# your Runway credits.
aws ssm put-parameter --name /music-video-studio/hackathon/BASIC_AUTH_USERNAME \
  --value 'mvs' --type String --region us-west-2

aws ssm put-parameter --name /music-video-studio/hackathon/BASIC_AUTH_PASSWORD \
  --value 'strong-password-here' --type SecureString --region us-west-2
```

## Apply (first time)

The `service` stack will fail to start a task if no image exists at `<ecr>:latest` yet. Bootstrap in four steps:

```bash
cd infra/envs/hackathon

# 1. Bring up everything except the service (which needs the image).
terragrunt -working-dir networking apply
terragrunt -working-dir ecr apply
terragrunt -working-dir alb apply
terragrunt -working-dir cluster apply
terragrunt -working-dir storage apply

# 2. Build + push the first image to ECR. (No service redeploy — the service
#    doesn't exist yet.)
../../scripts/bootstrap-ecr.sh

# 3. Bring up the service. With the image present, the task starts cleanly.
terragrunt -working-dir service apply

# 4. Front it with CloudFront + Basic Auth. CloudFront takes ~5–10 minutes
#    to deploy globally; the distribution domain is the entry point users
#    visit (https://<id>.cloudfront.net).
terragrunt -working-dir cloudfront apply

# 5. Re-apply the service so its WEB_ORIGIN env picks up the CloudFront
#    domain via the cross-stack dependency. (Otherwise the SPA's /api
#    fetches get blocked by Fastify's CORS.)
terragrunt -working-dir service apply
```

After this, `terragrunt run-all apply` from `infra/envs/hackathon` is a clean re-apply of everything.

## Push and deploy (subsequent updates)

```bash
infra/scripts/deploy-image.sh           # builds, pushes :latest, force-redeploys
infra/scripts/deploy-image.sh v0.0.2    # arbitrary tag
```

`deploy-image.sh` reuses `bootstrap-ecr.sh` for the build + push half, then calls `aws ecs update-service --force-new-deployment` to roll the running tasks.

Builds target `linux/amd64` (Fargate is x86_64 by default), so it works from an Apple Silicon laptop without surprise architecture mismatches.

## State

Remote state in S3 with DynamoDB locking — see the `remote_state` block in
`infra/terragrunt.hcl`. The bucket and table were bootstrapped out-of-band:

```bash
aws s3api create-bucket \
  --bucket music-video-studio-tfstate \
  --region us-west-2 \
  --create-bucket-configuration LocationConstraint=us-west-2

aws s3api put-bucket-versioning --bucket music-video-studio-tfstate \
  --versioning-configuration Status=Enabled --region us-west-2

aws s3api put-bucket-encryption --bucket music-video-studio-tfstate \
  --region us-west-2 --server-side-encryption-configuration \
  '{"Rules":[{"ApplyServerSideEncryptionByDefault":{"SSEAlgorithm":"AES256"}}]}'

aws s3api put-public-access-block --bucket music-video-studio-tfstate \
  --region us-west-2 --public-access-block-configuration \
  BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true

aws dynamodb create-table \
  --table-name music-video-studio-tflock \
  --attribute-definitions AttributeName=LockID,AttributeType=S \
  --key-schema AttributeName=LockID,KeyType=HASH \
  --billing-mode PAY_PER_REQUEST --region us-west-2
```

Object keys: `s3://music-video-studio-tfstate/envs/hackathon/<stack>/terraform.tfstate`.
Bucket has versioning + SSE + full public-access block; lock table is on-demand pricing.

## What it costs (rough)

- ALB: ~$22/mo (this is the main fixed cost)
- ECS Fargate task (2 vCPU / 4 GB, on-demand): ~$0.10/hr
- ECR storage: cents
- CloudWatch logs (7-day retention): cents
- CloudFront (PriceClass_100, US/EU only): per-GB transfer + per-million requests; pennies for hackathon traffic
- CloudFront Function: $0.10 per million invocations

For a hackathon weekend, expect ~$5–10 total. Tear down with `terragrunt run-all destroy` when done.

## Tear down

```bash
cd infra/envs/hackathon
terragrunt run-all destroy
```

ECR has `force_delete = true` so untagged images don't block destroy.
