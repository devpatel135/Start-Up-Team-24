#!/usr/bin/env bash
# Deploy the Trade Policy Risk Dashboard to a NEW AWS CloudFront distribution.
# This script creates stack "trade-policy-tool" and does NOT touch any other stack.
set -euo pipefail

STACK_NAME="trade-policy-tool"
REGION="us-east-1"

echo ""
echo "╔══════════════════════════════════════════════════════════════╗"
echo "║   Trade Policy Risk Dashboard — AWS Deployment              ║"
echo "║   Stack: ${STACK_NAME}                                ║"
echo "║   This is a NEW deployment. Existing sites are unaffected.  ║"
echo "╚══════════════════════════════════════════════════════════════╝"
echo ""

# ── Preflight ────────────────────────────────────────────────────────────────
command -v aws  >/dev/null 2>&1 || { echo "ERROR: AWS CLI not found. Install from https://aws.amazon.com/cli/"; exit 1; }
command -v sam  >/dev/null 2>&1 || { echo "ERROR: SAM CLI not found. Install from https://docs.aws.amazon.com/serverless-application-model/latest/developerguide/install-sam-cli.html"; exit 1; }

AWS_ACCOUNT=$(aws sts get-caller-identity --query Account --output text 2>/dev/null) \
  || { echo "ERROR: AWS credentials not configured. Run: aws configure"; exit 1; }

echo "→ AWS Account: ${AWS_ACCOUNT} | Region: ${REGION}"

# ── Artifacts bucket ─────────────────────────────────────────────────────────
ARTIFACTS_BUCKET="${ARTIFACTS_BUCKET:-trade-policy-tool-deploy-${AWS_ACCOUNT}}"
echo "→ Artifacts bucket: ${ARTIFACTS_BUCKET}"

if ! aws s3api head-bucket --bucket "${ARTIFACTS_BUCKET}" --region "${REGION}" 2>/dev/null; then
  echo "→ Creating artifacts bucket..."
  if [ "${REGION}" = "us-east-1" ]; then
    aws s3api create-bucket --bucket "${ARTIFACTS_BUCKET}" --region "${REGION}" >/dev/null
  else
    aws s3api create-bucket --bucket "${ARTIFACTS_BUCKET}" --region "${REGION}" \
      --create-bucket-configuration LocationConstraint="${REGION}" >/dev/null
  fi
fi

# ── Build ────────────────────────────────────────────────────────────────────
echo "→ Building Lambda packages..."
sam build --template template.yaml

# ── Deploy stack ─────────────────────────────────────────────────────────────
echo "→ Deploying CloudFormation stack: ${STACK_NAME}..."
sam deploy \
  --stack-name "${STACK_NAME}" \
  --s3-bucket "${ARTIFACTS_BUCKET}" \
  --region "${REGION}" \
  --capabilities CAPABILITY_IAM \
  --no-fail-on-empty-changeset

# ── Fetch outputs ─────────────────────────────────────────────────────────────
get_output() {
  aws cloudformation describe-stacks \
    --stack-name "${STACK_NAME}" \
    --region "${REGION}" \
    --query "Stacks[0].Outputs[?OutputKey=='${1}'].OutputValue" \
    --output text
}

echo "→ Reading stack outputs..."
CLOUDFRONT_URL=$(get_output "CloudFrontURL")
API_ENDPOINT=$(get_output "ApiEndpoint")
BUCKET=$(get_output "FrontendBucketName")

echo "   CloudFront : https://${CLOUDFRONT_URL}"
echo "   API        : ${API_ENDPOINT}"
echo "   S3 Bucket  : ${BUCKET}"

# ── Inject API endpoint into frontend ────────────────────────────────────────
echo "→ Injecting API endpoint into frontend..."
TMP_INDEX=$(mktemp /tmp/index_XXXXXX.html)
sed "s|window.API_BASE = ''|window.API_BASE = '${API_ENDPOINT}'|g" \
  frontend/index.html > "${TMP_INDEX}"

# ── Upload frontend ───────────────────────────────────────────────────────────
echo "→ Uploading frontend assets to S3..."
aws s3 sync frontend/ "s3://${BUCKET}/" \
  --exclude "*.html" \
  --cache-control "no-cache, no-store, must-revalidate" \
  --region "${REGION}"

aws s3 cp "${TMP_INDEX}" "s3://${BUCKET}/index.html" \
  --content-type "text/html" \
  --cache-control "no-cache, no-store, must-revalidate" \
  --region "${REGION}"

rm -f "${TMP_INDEX}"

# ── Invalidate CloudFront cache ───────────────────────────────────────────────
DIST_ID=$(aws cloudformation describe-stack-resource \
  --stack-name "${STACK_NAME}" \
  --logical-resource-id "CloudFrontDistribution" \
  --query "StackResourceDetail.PhysicalResourceId" \
  --output text 2>/dev/null || echo "")

if [ -n "${DIST_ID}" ]; then
  echo "→ Invalidating CloudFront cache..."
  aws cloudfront create-invalidation \
    --distribution-id "${DIST_ID}" \
    --paths "/*" \
    --region "${REGION}" \
    --query "Invalidation.Id" \
    --output text >/dev/null
fi

# ── Done ─────────────────────────────────────────────────────────────────────
echo ""
echo "╔══════════════════════════════════════════════════════════════╗"
echo "║   ✓  Deployment complete!                                   ║"
echo "║                                                              ║"
echo "║   Your new dashboard:                                        ║"
echo "║   https://${CLOUDFRONT_URL}"
echo "║                                                              ║"
echo "║   NOTE: CloudFront propagation takes 5–15 minutes.          ║"
echo "║   Your EXISTING deployment is completely unaffected.         ║"
echo "╚══════════════════════════════════════════════════════════════╝"
echo ""
echo "   Re-deploy after changes: ./deploy.sh"
echo "   Tear down:  aws cloudformation delete-stack --stack-name ${STACK_NAME} --region ${REGION}"
echo ""
