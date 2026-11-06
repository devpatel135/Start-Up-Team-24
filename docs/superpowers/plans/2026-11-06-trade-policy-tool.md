# Trade Policy Decision Tool — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a retail clothing buyer dashboard that shows Kalshi-sourced trade policy probabilities mapped to apparel landed cost impacts, with a Claude/Bedrock LLM risk summary, deployed as a new independent AWS stack.

**Architecture:** Vanilla HTML/CSS/JS frontend on S3+CloudFront; API Gateway routes to two Python Lambdas — `kalshi-fetcher` (pulls Kalshi markets, runs cost model, returns P10/P50/P90 per category) and `bedrock-analyzer` (takes that data, calls Claude claude-3-5-sonnet via Bedrock, returns plain-English summary); secrets in SSM.

**Tech Stack:** Python 3.12 (Lambda), `requests`, `boto3`; Vanilla JS (no build step); AWS SAM; CloudFormation stack name `trade-policy-tool`.

**Spec:** `docs/superpowers/specs/2026-11-06-trade-policy-decision-tool-design.md`

## Global Constraints

- Stack name MUST be `trade-policy-tool` — never deploy over an existing stack with a different name
- API keys stored in SSM `/trade-policy-tool/kalshi-api-key` (SecureString) only — never in code or git
- Python 3.12 runtime for all Lambdas
- Bedrock model: `anthropic.claude-3-5-sonnet-20241022-v2:0` in `us-east-1`
- CloudFront: HTTPS only, HTTP redirects enforced
- API Gateway throttle: 100 req/s, burst 200
- `.gitignore` must exclude `.env`, `samconfig.toml`, `__pycache__`, `.aws-sam`

## Review Focus

- Kalshi API returning no matching markets (zero-length list) → cost model must return zeroed P10/P50/P90, not crash; added to Task 2 test
- Bedrock throttling / model access not enabled in account → bedrock-analyzer must return a graceful fallback message, not a 500; added to Task 3 test
- Kalshi market price outside 0–1 range (API quirk) → clamp to [0,1] before cost calc; added to Task 2 test
- CORS preflight from CloudFront domain rejected by API Gateway → OPTIONS response must include correct headers; added to Task 4 verification
- SSM parameter missing at Lambda cold start → both Lambdas must raise a clear error message (not KeyError), logged to CloudWatch; added to Task 2 and Task 3 tests

---

## File Map

```
trade-policy-tool/
├── frontend/
│   ├── index.html          # Dashboard shell, section markup
│   ├── styles.css          # Impeccable design tokens, layout, components
│   └── app.js              # Fetch /trade-data + /analyze, render all sections
├── backend/
│   ├── kalshi_fetcher/
│   │   ├── handler.py      # Lambda entry point + cost model
│   │   └── requirements.txt
│   └── bedrock_analyzer/
│       ├── handler.py      # Lambda entry point + Bedrock call
│       └── requirements.txt
├── tests/
│   ├── test_kalshi_fetcher.py
│   └── test_bedrock_analyzer.py
├── template.yaml           # SAM: all AWS resources
├── deploy.sh               # One-command deploy (new stack)
├── .gitignore
└── README.md
```

---

## Task 1: Project Scaffold + Cost Impact Model

**Files:**
- Create: `backend/kalshi_fetcher/handler.py`
- Create: `backend/kalshi_fetcher/requirements.txt`
- Create: `tests/test_kalshi_fetcher.py`

**Interfaces:**
- Produces: `compute_cost_impacts(markets: list[dict]) -> dict` — called in Task 2's Lambda handler

**Category profiles (hardcode in `handler.py`):**
```python
CATEGORY_PROFILES = {
    "basics":    {"china_pct": 0.72, "import_factor": 0.28, "base_rate": 0.167},
    "denim":     {"china_pct": 0.45, "import_factor": 0.22, "base_rate": 0.168},
    "outerwear": {"china_pct": 0.58, "import_factor": 0.32, "base_rate": 0.278},
    "footwear":  {"china_pct": 0.65, "import_factor": 0.35, "base_rate": 0.200},
    "accessories":{"china_pct": 0.68, "import_factor": 0.25, "base_rate": 0.147},
    "activewear":{"china_pct": 0.55, "import_factor": 0.30, "base_rate": 0.167},
}
```

**Tariff scenario rates (hardcode):**
```python
SCENARIOS = {
    "p10": 0.00,   # optimistic: no change or reduction
    "p50": 0.15,   # moderate: +15 percentage points on base rate
    "p90": 0.35,   # severe: +35 percentage points on base rate
}
```

**`compute_cost_impacts(markets)` logic:**
- Average the `yes_price` values from `markets` (clamped to [0,1]); if empty, use 0.5
- For each category and each scenario key: `delta = profile["china_pct"] * profile["import_factor"] * scenario_rate`
- Weight delta by average probability: `weighted = delta * avg_prob`
- Return `{"basics": {"p10": 0.012, "p50": 0.045, "p90": 0.089}, ...}`

- [ ] **Step 1: Write failing tests**

```python
# tests/test_kalshi_fetcher.py
from backend.kalshi_fetcher.handler import compute_cost_impacts

def test_compute_returns_all_categories():
    result = compute_cost_impacts([{"yes_price": 0.6}])
    assert set(result.keys()) == {"basics","denim","outerwear","footwear","accessories","activewear"}

def test_compute_returns_p10_p50_p90():
    result = compute_cost_impacts([{"yes_price": 0.6}])
    for cat in result.values():
        assert set(cat.keys()) == {"p10", "p50", "p90"}

def test_empty_markets_returns_zero_p10():
    result = compute_cost_impacts([])
    assert result["basics"]["p10"] == 0.0

def test_price_clamped_above_one():
    result = compute_cost_impacts([{"yes_price": 1.5}])
    # should not raise, p90 should equal result with yes_price=1.0
    expected = compute_cost_impacts([{"yes_price": 1.0}])
    assert result["basics"]["p90"] == expected["basics"]["p90"]

def test_price_clamped_below_zero():
    result = compute_cost_impacts([{"yes_price": -0.3}])
    assert result["basics"]["p90"] >= 0.0
```

- [ ] **Step 2: Run to confirm FAIL**

```bash
cd trade-policy-tool && python -m pytest tests/test_kalshi_fetcher.py -v
```
Expected: ImportError / NameError — `compute_cost_impacts` not defined.

- [ ] **Step 3: Implement `compute_cost_impacts` in `backend/kalshi_fetcher/handler.py`**

Implement using `CATEGORY_PROFILES` and `SCENARIOS` above. Clamp each `yes_price` to `max(0.0, min(1.0, price))` before averaging.

- [ ] **Step 4: Run tests to confirm PASS**

```bash
python -m pytest tests/test_kalshi_fetcher.py -v
```
Expected: 5 PASSED.

- [ ] **Step 5: Commit**

```bash
git add backend/kalshi_fetcher/ tests/test_kalshi_fetcher.py
git commit -m "feat: add cost impact model with category profiles"
```

---

## Task 2: Kalshi Fetcher Lambda Handler

**Files:**
- Modify: `backend/kalshi_fetcher/handler.py` (add `lambda_handler`, `fetch_kalshi_markets`)
- Create: `backend/kalshi_fetcher/requirements.txt` (`requests==2.32.3`)

**Interfaces:**
- Consumes: `compute_cost_impacts` from Task 1
- Produces: `lambda_handler(event, context) -> dict` — API Gateway proxy response

**Kalshi API call:**
```
GET https://trading-api.kalshi.com/trade-api/v2/markets
  ?status=open
  &limit=100
Headers: Authorization: Bearer {key_from_ssm}
```

Filter response `.markets[]` where `title` or `subtitle` contains any of:
`["tariff", "trade", "import duty", "china", "section 301", "mfn", "usmca"]` (case-insensitive).

Map each matching market to: `{"id": m["ticker"], "title": m["title"], "yes_price": m["yes_price"], "expiry": m["close_time"]}`.

**SSM fetch:** Use `boto3.client("ssm").get_parameter(Name="/trade-policy-tool/kalshi-api-key", WithDecryption=True)`. If `ParameterNotFound`, raise `RuntimeError("SSM parameter /trade-policy-tool/kalshi-api-key not found")`.

**Lambda response shape:**
```json
{
  "markets": [...],
  "cost_impacts": {"basics": {"p10": 0.012, ...}, ...},
  "timestamp": "2026-11-06T14:23:00Z"
}
```

Wrap in API Gateway proxy envelope: `{"statusCode": 200, "headers": {"Access-Control-Allow-Origin": "*", "Content-Type": "application/json"}, "body": json.dumps(payload)}`.

- [ ] **Step 1: Write failing integration-style tests (mocked)**

```python
# tests/test_kalshi_fetcher.py  (append)
from unittest.mock import patch, MagicMock
from backend.kalshi_fetcher.handler import lambda_handler

MOCK_KALSHI_RESPONSE = {
    "markets": [
        {"ticker": "TARIFF-25", "title": "Will US tariffs on China exceed 50%?",
         "subtitle": "Section 301 tariff", "yes_price": 0.65, "close_time": "2026-12-31T00:00:00Z"},
        {"ticker": "UNRELATED", "title": "Will it rain in NYC?",
         "subtitle": "", "yes_price": 0.3, "close_time": "2026-12-31T00:00:00Z"},
    ]
}

def test_lambda_handler_filters_markets():
    with patch("backend.kalshi_fetcher.handler.boto3") as mock_boto, \
         patch("backend.kalshi_fetcher.handler.requests") as mock_req:
        mock_boto.client.return_value.get_parameter.return_value = {
            "Parameter": {"Value": "fake-key"}
        }
        mock_req.get.return_value.json.return_value = MOCK_KALSHI_RESPONSE
        mock_req.get.return_value.raise_for_status = MagicMock()
        resp = lambda_handler({}, {})
        import json
        body = json.loads(resp["body"])
        assert len(body["markets"]) == 1
        assert body["markets"][0]["id"] == "TARIFF-25"

def test_lambda_handler_missing_ssm_raises():
    import botocore.exceptions
    with patch("backend.kalshi_fetcher.handler.boto3") as mock_boto:
        mock_boto.client.return_value.get_parameter.side_effect = \
            mock_boto.client.return_value.exceptions.ParameterNotFound = Exception("ParameterNotFound")
        # handler should return 500 with error message, not raise unhandled
        resp = lambda_handler({}, {})
        assert resp["statusCode"] == 500
        assert "not found" in resp["body"].lower() or "error" in resp["body"].lower()
```

- [ ] **Step 2: Run to confirm FAIL**

```bash
python -m pytest tests/test_kalshi_fetcher.py::test_lambda_handler_filters_markets -v
```
Expected: ImportError or AttributeError.

- [ ] **Step 3: Implement `fetch_kalshi_markets(api_key)` and `lambda_handler` in `handler.py`**

`lambda_handler` wraps everything in try/except; on any exception returns `{"statusCode": 500, "body": json.dumps({"error": str(e)})}`.

- [ ] **Step 4: Run all kalshi tests**

```bash
python -m pytest tests/test_kalshi_fetcher.py -v
```
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/kalshi_fetcher/
git commit -m "feat: add kalshi fetcher lambda with market filtering and cost model"
```

---

## Task 3: Bedrock Analyzer Lambda

**Files:**
- Create: `backend/bedrock_analyzer/handler.py`
- Create: `backend/bedrock_analyzer/requirements.txt` (empty — boto3 built into Lambda runtime)
- Modify: `tests/test_bedrock_analyzer.py`

**Interfaces:**
- Consumes: POST body `{"markets": [...], "cost_impacts": {...}}` from frontend
- Produces: `lambda_handler` → `{"summary": "...", "risk_level": "moderate"}`

**Bedrock call:**
```python
client = boto3.client("bedrock-runtime", region_name="us-east-1")
response = client.invoke_model(
    modelId="anthropic.claude-3-5-sonnet-20241022-v2:0",
    body=json.dumps({
        "anthropic_version": "bedrock-2023-05-31",
        "max_tokens": 400,
        "messages": [{"role": "user", "content": PROMPT}]
    }),
    contentType="application/json",
    accept="application/json"
)
```

**Prompt template** (hardcode in handler):
```
You are a trade risk analyst for a retail clothing buyer.
Given these Kalshi prediction market results on trade policy:
{markets_summary}

And these probability-weighted landed cost impacts per apparel category:
{cost_impacts_summary}

Write exactly two paragraphs:
1. What the prediction markets are collectively signaling about trade policy risk over the next 90 days.
2. What this means practically for a clothing buyer with order deadlines in the next 90 days — specific, actionable, no hedging.

After the two paragraphs, output on a new line: RISK_LEVEL: low|moderate|high|severe
(based on P50 average cost impact: <2% = low, 2-5% = moderate, 5-10% = high, >10% = severe)
```

Parse `RISK_LEVEL:` line from response text. If Bedrock fails, return `{"summary": "Analysis temporarily unavailable. Review Kalshi market data directly.", "risk_level": "unknown"}`.

- [ ] **Step 1: Write failing tests**

```python
# tests/test_bedrock_analyzer.py
from unittest.mock import patch, MagicMock
import json
from backend.bedrock_analyzer.handler import lambda_handler, parse_risk_level

def test_parse_risk_level_moderate():
    text = "Some summary.\n\nMore text.\n\nRISK_LEVEL: moderate"
    assert parse_risk_level(text) == "moderate"

def test_parse_risk_level_missing_defaults_unknown():
    assert parse_risk_level("No risk level line here.") == "unknown"

def test_lambda_handler_bedrock_failure_returns_fallback():
    with patch("backend.bedrock_analyzer.handler.boto3") as mock_boto:
        mock_boto.client.return_value.invoke_model.side_effect = Exception("ThrottlingException")
        resp = lambda_handler({"body": json.dumps({"markets": [], "cost_impacts": {}})}, {})
        body = json.loads(resp["body"])
        assert resp["statusCode"] == 200
        assert body["risk_level"] == "unknown"
        assert "unavailable" in body["summary"].lower()

def test_lambda_handler_success():
    mock_body = json.dumps({
        "Body": MagicMock(read=lambda: json.dumps({
            "content": [{"text": "Para1\n\nPara2\n\nRISK_LEVEL: high"}]
        }).encode())
    })
    with patch("backend.bedrock_analyzer.handler.boto3") as mock_boto:
        mock_response = {"body": MagicMock(read=lambda: json.dumps({
            "content": [{"text": "Para1.\n\nPara2.\n\nRISK_LEVEL: high"}]
        }).encode())}
        mock_boto.client.return_value.invoke_model.return_value = mock_response
        resp = lambda_handler(
            {"body": json.dumps({"markets": [{"title": "Tariff?", "yes_price": 0.7}],
                                 "cost_impacts": {"basics": {"p50": 0.04}}})}, {}
        )
        body = json.loads(resp["body"])
        assert body["risk_level"] == "high"
        assert len(body["summary"]) > 20
```

- [ ] **Step 2: Run to confirm FAIL**

```bash
python -m pytest tests/test_bedrock_analyzer.py -v
```

- [ ] **Step 3: Implement `parse_risk_level(text)` and `lambda_handler` in `backend/bedrock_analyzer/handler.py`**

`parse_risk_level` uses `re.search(r"RISK_LEVEL:\s*(low|moderate|high|severe)", text, re.I)`.

- [ ] **Step 4: Run all tests**

```bash
python -m pytest tests/ -v
```
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/bedrock_analyzer/ tests/test_bedrock_analyzer.py
git commit -m "feat: add bedrock analyzer lambda with risk level parsing and fallback"
```

---

## Task 4: SAM Template (AWS Infrastructure)

**Files:**
- Create: `template.yaml`
- Create: `.gitignore`

**Resources to define in `template.yaml`:**

| Logical ID | Type | Key properties |
|---|---|---|
| `KalshiFetcherFunction` | `AWS::Serverless::Function` | Runtime `python3.12`, Handler `handler.lambda_handler`, CodeUri `backend/kalshi_fetcher/`, Timeout 30, Policies: `SSMParameterReadPolicy` for `/trade-policy-tool/kalshi-api-key` + `AmazonBedrockFullAccess` |
| `BedrockAnalyzerFunction` | `AWS::Serverless::Function` | Runtime `python3.12`, Timeout 30, Policies: `AmazonBedrockFullAccess` |
| `TradeApi` | `AWS::Serverless::Api` | StageName `prod`, Cors: `AllowOrigin: "'*'"`, `AllowHeaders: "'Content-Type,Authorization'"`, DefaultRouteSettings throttle 100/200 |
| `FrontendBucket` | `AWS::S3::Bucket` | WebsiteConfiguration index/error = `index.html`, PublicAccessBlockConfiguration all false |
| `BucketPolicy` | `AWS::S3::BucketPolicy` | Allow `s3:GetObject` to `*` |
| `CloudFrontDistribution` | `AWS::CloudFront::Distribution` | Origins: S3 website + API Gateway; DefaultRootObject `index.html`; ViewerProtocolPolicy `redirect-to-https` |

**Outputs:** `CloudFrontURL`, `ApiEndpoint`, `FrontendBucketName`

- [ ] **Step 1: Write `template.yaml`** per the resource table above. Use `Transform: AWS::Serverless-2016-10-31`.

- [ ] **Step 2: Validate template**

```bash
sam validate --template template.yaml --region us-east-1
```
Expected: `template.yaml is a valid SAM Template`.

- [ ] **Step 3: Write `.gitignore`**

```
.env
samconfig.toml
.aws-sam/
__pycache__/
*.pyc
node_modules/
```

- [ ] **Step 4: Verify CORS config present**

```bash
grep -i "AllowOrigin" template.yaml
```
Expected: at least one match.

- [ ] **Step 5: Commit**

```bash
git add template.yaml .gitignore
git commit -m "feat: add SAM template for new independent trade-policy-tool stack"
```

---

## Task 5: Frontend — Impeccable Dashboard

**Files:**
- Create: `frontend/index.html`
- Create: `frontend/styles.css`
- Create: `frontend/app.js`

**`index.html` sections (in order):**
1. `<header>` — title "Trade Policy Risk Dashboard", subtitle "Powered by Kalshi prediction markets + Claude AI", last-updated timestamp
2. `#risk-meter` — circular gauge container + label
3. `#category-cards` — grid container (populated by JS)
4. `#kalshi-feed` — market list container
5. `#llm-summary` — two-paragraph summary + skeleton loader
6. `#price-impact` — table container

**`styles.css` design tokens (Impeccable style):**
```css
:root {
  --bg: #0a0f1e;
  --surface: #111827;
  --surface-2: #1f2937;
  --border: #374151;
  --text: #f9fafb;
  --text-muted: #9ca3af;
  --accent: #6366f1;
  --accent-glow: rgba(99,102,241,0.15);
  --green: #10b981;
  --amber: #f59e0b;
  --red: #ef4444;
  --severe: #dc2626;
  --radius: 12px;
  --font: 'Inter', system-ui, sans-serif;
}
```

Risk meter colors: green (low), amber (moderate), red (high), `--severe` (severe).
Category card colors: green if P50 < 2%, amber if 2–5%, red if > 5%.

**`app.js` behavior:**
1. On `DOMContentLoaded`: call `loadDashboard()`
2. `loadDashboard()`: fetch `{API_BASE}/trade-data`, render markets + category cards, then POST `{API_BASE}/analyze` with the response body, render summary + risk meter
3. `API_BASE`: read from `window.API_BASE` (injected by deploy script into `index.html` before S3 upload) — fallback to `""` for local dev
4. Show skeleton loaders while fetching; replace with content or error state
5. Risk meter: SVG arc, stroke-dasharray driven by risk level (low=25%, moderate=50%, high=75%, severe=100%)
6. Category cards: show category name, icon (emoji), P10/P50/P90 as percentage impact, color-coded border
7. Kalshi market feed: each market shows title, yes_price as a percentage bar, expiry date
8. Price impact table: for each category, show "If absorbed: X% margin at risk", "If passed through: X% price increase needed" — derived from P50 cost impact

- [ ] **Step 1: Write `frontend/index.html`** with all section containers, `<link>` to `styles.css`, `<script>` for `app.js`, Inter font from Google Fonts, `<meta>` viewport.

- [ ] **Step 2: Write `frontend/styles.css`** — tokens above, full layout: dark background, card grid, risk meter, skeleton animation, responsive (mobile-first, 16px gutters).

- [ ] **Step 3: Write `frontend/app.js`** — `loadDashboard`, render functions per section, `API_BASE` from `window.API_BASE`.

- [ ] **Step 4: Smoke-test locally** — open `frontend/index.html` in browser with `API_BASE` pointed at `http://localhost:3000` (or just verify no JS parse errors in console with network calls failing gracefully with error state shown).

- [ ] **Step 5: Commit**

```bash
git add frontend/
git commit -m "feat: add impeccable dashboard frontend with risk meter and category cards"
```

---

## Task 6: Deploy Script + README

**Files:**
- Create: `deploy.sh`
- Create: `README.md`

**`deploy.sh`** (bash, executable):
```bash
#!/usr/bin/env bash
set -euo pipefail

STACK_NAME="trade-policy-tool"
REGION="us-east-1"
ARTIFACTS_BUCKET="${ARTIFACTS_BUCKET:-trade-policy-tool-artifacts-$(aws sts get-caller-identity --query Account --output text)}"

echo "→ Building Lambda packages..."
sam build --template template.yaml

echo "→ Creating artifacts bucket if needed..."
aws s3 mb "s3://${ARTIFACTS_BUCKET}" --region "$REGION" 2>/dev/null || true

echo "→ Deploying stack: $STACK_NAME (will NOT overwrite any other stack)..."
sam deploy \
  --stack-name "$STACK_NAME" \
  --s3-bucket "$ARTIFACTS_BUCKET" \
  --region "$REGION" \
  --capabilities CAPABILITY_IAM \
  --no-fail-on-empty-changeset

echo "→ Fetching outputs..."
CLOUDFRONT_URL=$(aws cloudformation describe-stacks \
  --stack-name "$STACK_NAME" --region "$REGION" \
  --query "Stacks[0].Outputs[?OutputKey=='CloudFrontURL'].OutputValue" \
  --output text)

API_ENDPOINT=$(aws cloudformation describe-stacks \
  --stack-name "$STACK_NAME" --region "$REGION" \
  --query "Stacks[0].Outputs[?OutputKey=='ApiEndpoint'].OutputValue" \
  --output text)

BUCKET=$(aws cloudformation describe-stacks \
  --stack-name "$STACK_NAME" --region "$REGION" \
  --query "Stacks[0].Outputs[?OutputKey=='FrontendBucketName'].OutputValue" \
  --output text)

echo "→ Injecting API endpoint into frontend..."
sed "s|window.API_BASE = ''|window.API_BASE = '${API_ENDPOINT}'|g" \
  frontend/index.html > /tmp/index_built.html

echo "→ Uploading frontend to S3..."
aws s3 sync frontend/ "s3://${BUCKET}/" \
  --exclude "index.html"
aws s3 cp /tmp/index_built.html "s3://${BUCKET}/index.html" \
  --content-type "text/html"

echo ""
echo "✓ Deployed! Your new dashboard URL:"
echo "  https://${CLOUDFRONT_URL}"
echo ""
echo "  (This is a NEW deployment — your existing site is untouched.)"
```

**`README.md`** must include:

1. **Prerequisites** — AWS CLI v2, SAM CLI, Python 3.12, Git
2. **Kalshi API key setup** — Create account at kalshi.com → API → copy key → store in SSM:
   ```bash
   aws ssm put-parameter \
     --name /trade-policy-tool/kalshi-api-key \
     --value "YOUR_KALSHI_KEY" \
     --type SecureString \
     --region us-east-1
   ```
3. **Enable Bedrock model** — AWS Console → Bedrock → Model access → enable `Claude 3.5 Sonnet`
4. **GitHub push**:
   ```bash
   git init   # if not already a repo
   git remote add origin https://github.com/YOUR_USERNAME/trade-policy-tool.git
   git push -u origin main
   ```
5. **Deploy to AWS (new site)**:
   ```bash
   chmod +x deploy.sh
   ./deploy.sh
   ```
   Output: a new `https://XXXXXXXXXX.cloudfront.net` URL — existing deployments unaffected.
6. **Re-deploy after changes**: run `./deploy.sh` again — idempotent, same stack.
7. **Tear down**: `aws cloudformation delete-stack --stack-name trade-policy-tool --region us-east-1`

- [ ] **Step 1: Write `deploy.sh`** per the script above. `chmod +x deploy.sh`.

- [ ] **Step 2: Write `README.md`** covering all 7 sections above.

- [ ] **Step 3: Verify deploy script syntax**

```bash
bash -n deploy.sh
```
Expected: no output (no syntax errors).

- [ ] **Step 4: Final test run**

```bash
python -m pytest tests/ -v
```
Expected: all PASS.

- [ ] **Step 5: Final commit**

```bash
git add deploy.sh README.md
git commit -m "feat: add deploy script and README for independent AWS deployment"
```
