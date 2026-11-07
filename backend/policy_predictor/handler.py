import json
import re
from datetime import datetime, timezone

import boto3
import requests

BEDROCK_MODEL_ID = "anthropic.claude-3-5-sonnet-20241022-v2:0"
BEDROCK_REGION = "us-east-1"
NEWSAPI_SSM_PATH = "/trade-policy-tool/newsapi-key"

CATEGORY_PROFILES = {
    "basics":      {"china_pct": 0.72, "import_factor": 0.28},
    "denim":       {"china_pct": 0.45, "import_factor": 0.22},
    "outerwear":   {"china_pct": 0.58, "import_factor": 0.32},
    "footwear":    {"china_pct": 0.65, "import_factor": 0.35},
    "accessories": {"china_pct": 0.68, "import_factor": 0.25},
    "activewear":  {"china_pct": 0.55, "import_factor": 0.30},
}

HISTORICAL_CONTEXT = """KEY HISTORICAL US TRADE POLICY FACTS (Apparel Imports):

Section 301 China Tariffs:
- 2018: Lists 1-3 imposed (25% on $250B+ goods incl. HTS Chapters 61-62 apparel)
- 2019: List 4A (15% consumer goods/apparel); reduced to 7.5% in Phase 1 deal (Jan 2020)
- 2022-2024: Biden maintained tariffs; raised rates on EVs/solar/steel; apparel unchanged at 7.5-25%
- 2025 (Trump admin): Executive orders proposing 60%+ blanket tariffs on all Chinese imports; legal/legislative process ongoing
- Current effective rate on Chinese woven apparel: ~44.5% (MFN 12% + List 3 25% + List 4A 7.5%)

USMCA:
- In force July 2020. Duty-free for North American qualifying goods (yarn-forward for apparel)
- Mandatory 6-year review opens 2026; any party may exit with 6-month notice
- Current status: active and stable; no apparel-specific provisions under immediate threat

MFN Tariff Rates:
- Base US import tariffs (~12-17%) apply to Vietnam, Bangladesh, Indonesia, EU
- Not subject to Section 301; stable unless major WTO dispute

GSP (Generalized System of Preferences):
- Lapsed December 2017; NOT renewed for apparel categories
- Effectively inactive for clothing importers since 2018

Vietnam Trade Exposure:
- USTR opened Section 301 investigation on currency practices (2020); no tariffs imposed
- MFN rates (~12-17%) apply; risk of escalation if trade imbalance grows"""

DEFAULT_PREDICTIONS = {
    "scenario_tariff_deltas": {"p10": 0.0, "p50": 0.15, "p90": 0.40},
    "scenario_probs": {"p10": 0.25, "p50": 0.50, "p90": 0.25},
    "policy_status": [
        {
            "id": "section301",
            "name": "Section 301 China Tariffs",
            "status": "active",
            "direction": "escalating",
            "risk": "high",
            "note": "Current 25-44.5% effective rate; 60%+ proposals under active legislative review.",
        },
        {
            "id": "usmca",
            "name": "USMCA",
            "status": "active",
            "direction": "uncertain",
            "risk": "moderate",
            "note": "2026 mandatory review window approaching; US exit requires 6-month notice.",
        },
        {
            "id": "mfn",
            "name": "MFN Tariff Rates",
            "status": "active",
            "direction": "stable",
            "risk": "low",
            "note": "Base ~12-17% rates stable; no immediate WTO negotiation risk.",
        },
        {
            "id": "gsp",
            "name": "GSP (Developing Country Preferences)",
            "status": "lapsed",
            "direction": "uncertain",
            "risk": "moderate",
            "note": "Lapsed 2017; not renewed for apparel; no reinstatement expected near-term.",
        },
        {
            "id": "vietnam",
            "name": "Vietnam Trade Exposure",
            "status": "under_review",
            "direction": "uncertain",
            "risk": "moderate",
            "note": "USTR currency investigation open but dormant; MFN rates currently apply.",
        },
    ],
    "alerts": [
        {
            "severity": "critical",
            "title": "60%+ China Tariff Proposals Active",
            "detail": "Trump administration proposals to impose 60%+ blanket tariffs on Chinese imports remain active legislative targets. If enacted, effective rate on Chinese apparel would exceed 70%. Orders with China delivery in the next 90 days carry significant exposure.",
            "category": "tariff",
        },
        {
            "severity": "warning",
            "title": "USMCA 2026 Review Window Opening",
            "detail": "The 6-year mandatory USMCA review opens in 2026. All parties may renegotiate apparel rules of origin. Early sourcing diversification to qualifying North American suppliers reduces long-term exposure.",
            "category": "policy_change",
        },
        {
            "severity": "info",
            "title": "Vietnam: Low-Risk Alternative Sourcing",
            "detail": "Vietnam-sourced apparel faces MFN rates (~12-17%) with no Section 301 exposure. USTR currency investigation remains dormant. Consider as diversification hedge against China tariff escalation.",
            "category": "supply_chain",
        },
    ],
    "reasoning": (
        "Current distribution reflects elevated but uncertain China tariff escalation risk. "
        "The 60%+ tariff proposal faces legal and economic headwinds, making a severe outcome (P90) "
        "less probable than a moderate increase (P50). An optimistic scenario (P10) reflects a "
        "possible trade deal framework or court-ordered pause on tariff authority."
    ),
}

PREDICTION_PROMPT = """You are a trade policy risk analyst for a US retail apparel buyer. Analyze current conditions and return a valid JSON analysis only — no other text, no markdown code fences.

{historical_context}

{news_section}

Return this exact JSON object with no markdown, no explanation:
{{
  "scenario_tariff_deltas": {{
    "p10": <optimistic float: effective tariff rate change e.g. 0.0 or negative for de-escalation>,
    "p50": <moderate float: e.g. 0.15 for +15 percentage points>,
    "p90": <severe float: e.g. 0.40 for +40 percentage points>
  }},
  "scenario_probs": {{
    "p10": <float 0-1; all three MUST sum to 1.0>,
    "p50": <float 0-1>,
    "p90": <float 0-1>
  }},
  "policy_status": [
    {{"id": "section301", "name": "Section 301 China Tariffs", "status": "active|lapsed|under_review|proposed", "direction": "stable|escalating|de-escalating|uncertain", "risk": "low|moderate|high|severe", "note": "<one sentence>"}},
    {{"id": "usmca", "name": "USMCA", "status": "...", "direction": "...", "risk": "...", "note": "..."}},
    {{"id": "mfn", "name": "MFN Tariff Rates", "status": "...", "direction": "...", "risk": "...", "note": "..."}},
    {{"id": "gsp", "name": "GSP (Developing Country Preferences)", "status": "...", "direction": "...", "risk": "...", "note": "..."}},
    {{"id": "vietnam", "name": "Vietnam Trade Exposure", "status": "...", "direction": "...", "risk": "...", "note": "..."}}
  ],
  "alerts": [
    {{"severity": "critical|warning|info", "title": "<short title>", "detail": "<2-3 sentences specific to apparel retail>", "category": "tariff|supply_chain|currency|policy_change"}}
  ],
  "reasoning": "<2-3 sentences explaining your probability estimates>"
}}

Generate 2-4 alerts. scenario_probs must sum to exactly 1.0."""


def fetch_news_headlines(api_key: str) -> list:
    try:
        resp = requests.get(
            "https://newsapi.org/v2/everything",
            params={
                "q": "tariff OR \"trade policy\" OR \"import duty\" OR \"Section 301\" OR \"China trade\"",
                "language": "en",
                "sortBy": "publishedAt",
                "pageSize": 8,
            },
            headers={"X-Api-Key": api_key},
            timeout=5,
        )
        resp.raise_for_status()
        articles = resp.json().get("articles", [])
        return [
            {
                "title": a.get("title", ""),
                "source": a.get("source", {}).get("name", ""),
                "publishedAt": a.get("publishedAt", "")[:10],
            }
            for a in articles[:8]
            if a.get("title")
        ]
    except Exception:
        return []


def get_llm_predictions(news_headlines: list) -> dict | None:
    if news_headlines:
        news_section = "RECENT NEWS HEADLINES:\n" + "\n".join(
            f"- [{a['source']}] {a['title']}" for a in news_headlines
        )
    else:
        news_section = (
            "RECENT NEWS: No live feed available — reason from "
            "training knowledge and historical context above."
        )

    prompt = PREDICTION_PROMPT.format(
        historical_context=HISTORICAL_CONTEXT,
        news_section=news_section,
    )

    bedrock = boto3.client("bedrock-runtime", region_name=BEDROCK_REGION)
    response = bedrock.invoke_model(
        modelId=BEDROCK_MODEL_ID,
        body=json.dumps({
            "anthropic_version": "bedrock-2023-05-31",
            "max_tokens": 2500,
            "messages": [{"role": "user", "content": prompt}],
        }),
        contentType="application/json",
        accept="application/json",
    )
    text = json.loads(response["body"].read())["content"][0]["text"]

    # Extract JSON — handle optional markdown code fences
    json_match = re.search(r"\{.*\}", text, re.DOTALL)
    if json_match:
        return json.loads(json_match.group())
    return None


def compute_cost_impacts(predictions: dict) -> dict:
    tariff_deltas = predictions.get(
        "scenario_tariff_deltas",
        DEFAULT_PREDICTIONS["scenario_tariff_deltas"],
    )
    result = {}
    for cat, profile in CATEGORY_PROFILES.items():
        result[cat] = {}
        for scenario in ("p10", "p50", "p90"):
            delta = max(0.0, float(tariff_deltas.get(scenario, 0.0)))
            result[cat][scenario] = round(profile["china_pct"] * profile["import_factor"] * delta, 4)
    return result


def _cors_headers() -> dict:
    return {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "Content-Type,Authorization",
        "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
        "Content-Type": "application/json",
    }


def lambda_handler(event, context):
    if event.get("httpMethod") == "OPTIONS":
        return {"statusCode": 200, "headers": _cors_headers(), "body": ""}

    # Optional: fetch live news (graceful degradation — no key = no news)
    news_headlines = []
    try:
        ssm = boto3.client("ssm", region_name="us-east-1")
        param = ssm.get_parameter(Name=NEWSAPI_SSM_PATH, WithDecryption=True)
        api_key = param["Parameter"]["Value"]
        news_headlines = fetch_news_headlines(api_key)
    except Exception:
        pass

    # LLM-driven predictions (graceful degradation — Bedrock failure = defaults)
    try:
        predictions = get_llm_predictions(news_headlines) or DEFAULT_PREDICTIONS
    except Exception:
        predictions = DEFAULT_PREDICTIONS

    cost_impacts = compute_cost_impacts(predictions)

    payload = {
        "predictions": {
            "scenario_probs": predictions.get("scenario_probs", DEFAULT_PREDICTIONS["scenario_probs"]),
            "scenario_tariff_deltas": predictions.get(
                "scenario_tariff_deltas", DEFAULT_PREDICTIONS["scenario_tariff_deltas"]
            ),
            "reasoning": predictions.get("reasoning", DEFAULT_PREDICTIONS["reasoning"]),
        },
        "policy_status": predictions.get("policy_status", DEFAULT_PREDICTIONS["policy_status"]),
        "alerts": predictions.get("alerts", DEFAULT_PREDICTIONS["alerts"]),
        "cost_impacts": cost_impacts,
        "news_headlines": news_headlines,
        "has_live_news": bool(news_headlines),
        "timestamp": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
    }

    return {
        "statusCode": 200,
        "headers": _cors_headers(),
        "body": json.dumps(payload),
    }
