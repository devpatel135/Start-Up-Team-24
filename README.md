# Trade Policy Risk Dashboard

A web dashboard for retail clothing buyers that shows probability-weighted trade policy predictions from [Kalshi](https://kalshi.com) prediction markets, maps them to landed cost impacts across six apparel categories, and delivers a plain-English risk summary via Claude 3.5 Sonnet on AWS Bedrock.

**What it solves:** Retailers commit to next-season orders on stale cost assumptions, then absorb 2–3 margin points when tariffs shift mid-cycle. This tool makes the probability distribution visible before you commit.

---

## Prerequisites

| Tool | Version | Install |
|------|---------|---------|
| AWS CLI | v2 | [aws.amazon.com/cli](https://aws.amazon.com/cli/) |
| SAM CLI | latest | [Install guide](https://docs.aws.amazon.com/serverless-application-model/latest/developerguide/install-sam-cli.html) |
| Python | 3.12+ | [python.org](https://python.org) |
| Git | any | [git-scm.com](https://git-scm.com) |

---

## Step 1 — Kalshi API key

1. Create an account at [kalshi.com](https://kalshi.com)
2. Go to **Account → API** and generate an API key
3. Store it in AWS SSM (this keeps it off disk and out of git):

```bash
aws ssm put-parameter \
  --name /trade-policy-tool/kalshi-api-key \
  --value "YOUR_KALSHI_API_KEY_HERE" \
  --type SecureString \
  --region us-east-1
```

---

## Step 2 — Enable Bedrock model access

1. Open the [AWS Console → Bedrock](https://console.aws.amazon.com/bedrock/home?region=us-east-1#/modelaccess)
2. Click **Manage model access**
3. Enable **Claude 3.5 Sonnet** (Anthropic)
4. Click **Save changes** (takes ~2 minutes)

---

## Step 3 — Push to GitHub

```bash
# If this is a fresh clone or new repo:
git init
git add -A
git commit -m "feat: initial trade policy dashboard"

# Add your GitHub remote and push:
git remote add origin https://github.com/YOUR_USERNAME/trade-policy-tool.git
git branch -M main
git push -u origin main
```

> **Note:** `samconfig.toml` and `.env` are in `.gitignore` — they will never be committed.  
> Your Kalshi API key lives in SSM only and never touches git.

---

## Step 4 — Deploy to AWS (new site, existing sites unaffected)

```bash
chmod +x deploy.sh
./deploy.sh
```

The script will:
1. Build the Lambda packages with SAM
2. Create a **new** CloudFormation stack called `trade-policy-tool`
3. Deploy a **new** S3 bucket + CloudFront distribution (new URL)
4. Upload the frontend with the API endpoint injected

**Output:** a fresh `https://XXXXXXXXXX.cloudfront.net` URL — your existing CloudFront deployment is never touched.

> CloudFront propagation takes **5–15 minutes** after first deploy.

---

## Re-deploying after code changes

```bash
./deploy.sh
```

Idempotent — runs against the same `trade-policy-tool` stack. Only changed resources are updated.

---

## Architecture

```
Browser (CloudFront)
    ↓ GET /trade-data
API Gateway
    └─ Lambda: kalshi-fetcher
           ├─ Fetches Kalshi prediction markets (key from SSM)
           ├─ Filters for trade-policy markets
           └─ Computes P10 / P50 / P90 cost impact per category

    ↓ POST /analyze (body = trade data from above)
    └─ Lambda: bedrock-analyzer
           └─ Calls Claude 3.5 Sonnet → plain-English risk summary
```

### Cost model

For each apparel category, the landed cost impact is:

```
delta = china_sourcing_pct × import_cost_factor × tariff_scenario_rate
weighted_delta = delta × avg_market_probability
```

| Scenario | Tariff Δ | Meaning |
|----------|----------|---------|
| P10 | +0 pp | Optimistic — no escalation |
| P50 | +15 pp | Moderate escalation |
| P90 | +35 pp | Severe escalation |

---

## Running tests locally

```bash
pip install pytest boto3 requests
python -m pytest tests/ -v
```

---

## Tearing down

This only removes the `trade-policy-tool` stack — nothing else:

```bash
aws cloudformation delete-stack \
  --stack-name trade-policy-tool \
  --region us-east-1
```

Then remove the artifacts bucket if desired:

```bash
aws s3 rb s3://trade-policy-tool-deploy-ACCOUNT_ID --force
```

---

## Security notes

- Kalshi API key is stored in SSM SecureString — never in code or git
- Lambda IAM roles are least-privilege (SSM read + Bedrock invoke only)
- API Gateway throttled at 100 req/s (burst 200)
- CloudFront enforces HTTPS
- No PII collected, no authentication required (public sandbox deployment)
