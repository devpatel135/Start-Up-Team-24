# Trade Policy Decision Tool — Design Spec

**Date:** 2026-11-06  
**Author:** Dev Patel  
**Status:** Approved for implementation

---

## Purpose

A web dashboard for retail clothing buyers that surfaces probability-weighted trade policy predictions from Kalshi prediction markets, maps those probabilities to landed cost impact across six apparel categories, and delivers a plain-English LLM risk summary via Claude on AWS Bedrock. The buyer reads it, understands their cost exposure before order deadlines, and commits with open eyes instead of guessing.

**Problem it solves:** Retailers commit to next-season orders on stale cost assumptions, then absorb 2–3 margin points when tariffs shift mid-cycle. This tool makes the probability distribution visible before the commitment.

---

## Success Criteria

- Live Kalshi market probabilities visible on page load
- Cost impact shown as P10 / P50 / P90 landed cost scenarios per apparel category
- LLM summary renders in < 5 seconds
- Deployed to a **new** CloudFront URL independent of any existing deployment
- API keys never exposed in browser JS
- No login required (sandbox deployment)

---

## Architecture

### Components

```
Browser (S3/CloudFront)
    ↓ fetch
API Gateway (REST, throttled)
    ├─ /trade-data  →  Lambda: kalshi-fetcher
    │                     ├─ Calls Kalshi REST API (key from SSM)
    │                     └─ Returns: markets + cost impact model
    └─ /analyze     →  Lambda: bedrock-analyzer
                          ├─ Receives market + cost data
                          └─ Calls Bedrock claude-3-5-sonnet
                              Returns: plain-English risk summary
```

### AWS Services

| Service | Role |
|---|---|
| S3 | Frontend static assets |
| CloudFront | CDN — **new distribution, new URL** |
| API Gateway | REST API with throttling (100 req/s) |
| Lambda (kalshi-fetcher) | Fetches Kalshi markets, computes cost impacts |
| Lambda (bedrock-analyzer) | Calls Bedrock, returns LLM summary |
| SSM Parameter Store | Kalshi API key (SecureString), Bedrock region |
| IAM | Least-privilege roles per Lambda |

All resources in `us-east-1`. Stack name: `trade-policy-tool` (distinct from any existing stack).

---

## Data Model

### Kalshi Market Mapping

Fetch markets matching keywords: `tariff`, `trade`, `import duty`, `China`, `Section 301`, `MFN`, `USMCA`. Map each to one or more apparel categories.

### Apparel Categories

1. Basics (T-shirts, socks, underwear)
2. Denim
3. Outerwear (coats, jackets)
4. Footwear
5. Accessories (belts, bags, hats)
6. Activewear

### Cost Impact Model

For each category, store:
- `china_sourcing_pct`: % of category typically sourced from China (industry averages)
- `import_cost_factor`: import cost as % of retail price
- `hts_base_rate`: current base tariff rate (HTS schedule)

Tariff scenario → landed cost delta:
```
delta = china_sourcing_pct × import_cost_factor × (new_rate - base_rate)
```

Scenario probabilities come from Kalshi market prices (0–1).

Outputs: P10, P50, P90 landed cost impact per category.

---

## UI Design

### Layout (Impeccable)

**Header:** "Trade Policy Risk Dashboard" — updated timestamp, Kalshi data freshness indicator

**Section 1 — Headline Risk Meter**
Large circular gauge: Overall Risk Level (Low / Moderate / High / Severe) derived from probability-weighted average tariff impact across categories.

**Section 2 — Category Cost Impact Cards**
Six cards (one per apparel category). Each card shows:
- Category name + icon
- Current assumed landed cost (baseline)
- P10 / P50 / P90 cost impact ($ and %)
- Color coding: green (< 2% impact), amber (2–5%), red (> 5%)

**Section 3 — Live Kalshi Markets**
Feed of the matched Kalshi markets: event name, current Yes probability, price chart thumbnail, days to expiry.

**Section 4 — LLM Risk Summary**
Two-paragraph plain-English summary from Claude:
- What the prediction markets are saying collectively
- What it means for a clothing buyer with order deadlines in the next 90 days

**Section 5 — Price Impact Callout**
Simple table: if absorbed, what margin % is at risk; if passed through, what % price increase is needed per category.

---

## Security

- Kalshi API key stored in SSM `/trade-policy-tool/kalshi-api-key` (SecureString)
- Lambda IAM roles: `kalshi-fetcher` has `ssm:GetParameter` + `execute-api:Invoke` only; `bedrock-analyzer` has `bedrock:InvokeModel` only
- API Gateway: CORS locked to CloudFront domain, throttling 100 req/s burst 200
- No PII collected, no cookies, no auth
- CloudFront: HTTPS only, HTTP redirects to HTTPS

---

## Deployment

### New Stack (does not touch existing deployment)

SAM template named `trade-policy-tool`. Deployed as:
```bash
sam deploy --stack-name trade-policy-tool --s3-bucket <new-artifacts-bucket> ...
```

Produces a new CloudFront URL (e.g., `https://XXXXXXXXXXX.cloudfront.net`).

### GitHub

Standard repo push. Secrets (Kalshi API key) stay in SSM — never committed to git. `.gitignore` excludes `.env`, `samconfig.toml` (which may contain account IDs).

---

## Out of Scope (v1)

- User authentication / per-buyer saved views
- ERP/OMS integration
- Historical probability tracking (DynamoDB)
- Mobile-native app
- Real-time WebSocket updates (polling every 60s is sufficient)
