import json
import re
from datetime import datetime, timezone

import boto3

from signals import (
    fetch_news,
    fetch_executive_orders,
    fetch_x_tweets,
    compute_frequency_model,
    bayesian_update_probs,
    format_signals_for_prompt,
)

BEDROCK_MODEL_ID = "anthropic.claude-3-5-sonnet-20241022-v2:0"
BEDROCK_REGION = "us-east-1"
NEWSAPI_SSM_PATH = "/trade-policy-tool/newsapi-key"
TWITTER_SSM_PATH = "/trade-policy-tool/twitter-bearer-token"

CATEGORY_PROFILES = {
    "basics":      {"china_pct": 0.72, "import_factor": 0.28},
    "denim":       {"china_pct": 0.45, "import_factor": 0.22},
    "outerwear":   {"china_pct": 0.58, "import_factor": 0.32},
    "footwear":    {"china_pct": 0.65, "import_factor": 0.35},
    "accessories": {"china_pct": 0.68, "import_factor": 0.25},
    "activewear":  {"china_pct": 0.55, "import_factor": 0.30},
}

HISTORICAL_CONTEXT = """KEY HISTORICAL US TRADE POLICY FACTS (Apparel Imports):

Section 301 China Tariffs — CURRENT STATUS (2025):
- 2018: Lists 1-3 (25% on $250B+ goods incl. HTS Chapters 61-62 apparel)
- 2019: List 4A (15% consumer goods/apparel); reduced to 7.5% in Phase 1 deal (Jan 2020)
- 2022-2024: Biden maintained tariffs; apparel remained at 7.5-25% Section 301
- April 2, 2025 ("Liberation Day"): Executive Order imposed ADDITIONAL 125% reciprocal surcharge on all Chinese imports
  - Combined EFFECTIVE tariff on Chinese woven apparel: approximately 145%
  - (10% emergency base + 125% reciprocal Section 301 supplemental + legacy 7.5-25%)
  - This rate is FULLY IN EFFECT — no pause, no court stay as of mid-2025
  - China is explicitly excluded from any pause announcements

April 9, 2025 — 90-Day Pause on Most (not China) Reciprocal Tariffs:
- 90-day pause on "Liberation Day" reciprocal tariffs for most countries except China
- Vietnam: 46% reciprocal tariff PAUSED; interim 10% rate applies during pause window
- Bangladesh: 37% reciprocal tariff PAUSED; interim 10% rate applies during pause window
- Indonesia, Cambodia, others: similar pause structure
- Pause expiry risk: if not renewed, Vietnam/Bangladesh revert to 46%/37% rates
  — THIS IS A MAJOR RISK for buyers using Vietnam/Bangladesh as China alternatives

USMCA:
- In force July 2020; duty-free for qualifying North American goods (yarn-forward for apparel)
- Mexico explicitly EXEMPT from April 2025 reciprocal tariffs; remains 0% for qualifying apparel
- Mandatory 6-year review opens 2026; any party may exit with 6-month notice
- Most stable apparel sourcing option; limited production capacity is the constraint

MFN Tariff Rates:
- Base US import tariffs (~12-17%) apply to countries not hit by reciprocal tariffs
- Stable unless specific executive orders or WTO disputes arise

GSP (Generalized System of Preferences):
- Lapsed December 2017; NOT renewed for apparel categories; effectively inactive

Vietnam Trade Exposure (UPDATED 2025):
- 46% reciprocal tariff announced April 2025; currently on 90-day pause (10% interim)
- If pause expires: Vietnam loses competitive advantage vs China on tariff cost basis
- Key buyer risk: orders committed for Spring 2027 delivery may ship after pause window closes

Bangladesh Trade Exposure (UPDATED 2025):
- 37% reciprocal tariff announced April 2025; currently on 90-day pause (10% interim)
- Same pause expiry risk as Vietnam — previously cheapest sourcing alternative at ~15.3% MFN"""

DEFAULT_PREDICTIONS = {
    "scenario_tariff_deltas": {"p10": 0.0, "p50": 0.145, "p90": 0.42},
    "scenario_probs": {"p10": 0.20, "p50": 0.55, "p90": 0.25},
    "policy_status": [
        {
            "id": "section301",
            "name": "China Section 301 Tariffs",
            "status": "active",
            "direction": "escalating",
            "risk": "severe",
            "note": "145% effective rate fully in force (10% base + 125% reciprocal). No pause. Highest rate in modern US trade history.",
        },
        {
            "id": "vietnam_pause",
            "name": "Vietnam 90-Day Tariff Pause",
            "status": "active",
            "direction": "uncertain",
            "risk": "high",
            "note": "46% rate paused; interim 10% applies. Pause expires before Spring 2027 orders ship — revert risk is HIGH.",
        },
        {
            "id": "bangladesh_pause",
            "name": "Bangladesh 90-Day Tariff Pause",
            "status": "active",
            "direction": "uncertain",
            "risk": "high",
            "note": "37% rate paused; interim 10% applies. Same pause-expiry risk as Vietnam for Spring 2027 orders.",
        },
        {
            "id": "usmca",
            "name": "USMCA (Mexico)",
            "status": "active",
            "direction": "stable",
            "risk": "low",
            "note": "Mexico explicitly exempt from April 2025 reciprocal tariffs. 0% for qualifying apparel. 2026 review is routine.",
        },
        {
            "id": "gsp",
            "name": "GSP (Developing Country Preferences)",
            "status": "lapsed",
            "direction": "stable",
            "risk": "low",
            "note": "Lapsed 2017; not renewed for apparel. Not a factor in current trade environment.",
        },
    ],
    "alerts": [
        {
            "severity": "critical",
            "title": "145% China Tariff — Fully Active, No Pause",
            "detail": "The 145% effective tariff rate on Chinese apparel is in full force with no court stay or pause. Any Spring 2027 order sourced from China at current cost assumptions will face a landed cost increase of 29–40% across categories. Immediate sourcing diversification audit required.",
            "category": "tariff",
        },
        {
            "severity": "critical",
            "title": "Vietnam/Bangladesh Pause Expiry Before Spring 2027 Delivery",
            "detail": "The 90-day pause on 46% (Vietnam) and 37% (Bangladesh) reciprocal tariffs may expire well before Spring 2027 orders ship. Orders committed now on the assumption of 10% interim rates could face the full reciprocal rate at landing. Model both scenarios before committing.",
            "category": "tariff",
        },
        {
            "severity": "warning",
            "title": "Order Deadline Risk: March 1, 2027",
            "detail": "Spring 2027 purchase order commitments are due by March 1, 2027. Tariff policy is actively changing. Orders placed at current cost assumptions may need to be repriced if the Vietnam/Bangladesh pause expires. Build contractual price-adjustment provisions before committing.",
            "category": "policy_change",
        },
        {
            "severity": "info",
            "title": "Mexico (USMCA): Only Fully-Exempt Sourcing Option",
            "detail": "Mexico-sourced qualifying apparel remains at 0% tariff — the only major sourcing origin fully exempt from April 2025 trade actions. Limited production capacity is the constraint. Worth exploring for core SKUs with 30–45 day lead times.",
            "category": "supply_chain",
        },
    ],
    "reasoning": (
        "With 145% China tariffs fully in force and Vietnam/Bangladesh pause expiry uncertain, "
        "the moderate (P50) scenario at +14.5pp additional tariff delta reflects continued "
        "escalation risk beyond current baseline. Optimistic (P10, 0pp delta) requires a formal "
        "US-China trade deal — unlikely before March 2027. Severe (P90, +42pp) reflects full "
        "Vietnam/Bangladesh reversion plus additional China measures."
    ),
}

PREDICTION_PROMPT = """You are a trade policy risk analyst for a US retail apparel buyer. Analyze current conditions and return a valid JSON analysis only — no other text, no markdown code fences.

{historical_context}

{signals_section}

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
  "reasoning": "<2-3 sentences explaining your probability estimates, citing any signal evidence above>"
}}

Generate 2-4 alerts. scenario_probs must sum to exactly 1.0. Use signal analysis above to inform and adjust your probability estimates."""


def get_llm_predictions(signals_section: str) -> dict | None:
    prompt = PREDICTION_PROMPT.format(
        historical_context=HISTORICAL_CONTEXT,
        signals_section=signals_section,
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

    ssm = boto3.client("ssm", region_name="us-east-1")

    # ── Gather all signal items ──────────────────────────────────────────────
    all_signal_items = []

    # 1. Federal Register executive orders (free, no key)
    eo_items = fetch_executive_orders(days_back=90)
    all_signal_items.extend(eo_items)

    # 2. NewsAPI (optional — SSM key)
    news_headlines = []
    try:
        param = ssm.get_parameter(Name=NEWSAPI_SSM_PATH, WithDecryption=True)
        news_items = fetch_news(param["Parameter"]["Value"])
        all_signal_items.extend(news_items)
        news_headlines = [
            {"title": i["title"], "source": i["source"], "publishedAt": i["published"]}
            for i in news_items
        ]
    except Exception:
        pass

    # 3. X / Twitter (optional — SSM key)
    tweet_items = []
    try:
        param = ssm.get_parameter(Name=TWITTER_SSM_PATH, WithDecryption=True)
        tweet_items = fetch_x_tweets(param["Parameter"]["Value"], max_results=50)
        all_signal_items.extend(tweet_items)
    except Exception:
        pass

    # ── Frequency model ──────────────────────────────────────────────────────
    freq_result = compute_frequency_model(all_signal_items)
    signals_section = format_signals_for_prompt(freq_result, all_signal_items)

    # ── LLM predictions (graceful degradation) ───────────────────────────────
    try:
        predictions = get_llm_predictions(signals_section) or DEFAULT_PREDICTIONS
    except Exception:
        predictions = DEFAULT_PREDICTIONS

    # ── Bayesian probability update using signal evidence ────────────────────
    llm_probs = predictions.get("scenario_probs", DEFAULT_PREDICTIONS["scenario_probs"])
    adjusted_probs = bayesian_update_probs(llm_probs, freq_result)

    # Inject adjusted probs back into predictions (keep LLM tariff deltas)
    predictions["scenario_probs"] = adjusted_probs
    predictions["scenario_probs_llm_raw"] = llm_probs  # preserved for transparency

    cost_impacts = compute_cost_impacts(predictions)

    now = datetime.now(timezone.utc)
    deadline = datetime(2027, 3, 1, tzinfo=timezone.utc)
    deadline_days = max(0, (deadline - now).days)

    # Build public top_signals list (strip internal scoring fields)
    public_top_signals = [
        {
            "title": s["title"],
            "source": s["source"],
            "source_type": s["source_type"],
            "published": s.get("published", ""),
        }
        for s in freq_result.get("top_signals", [])
    ]

    payload = {
        "predictions": {
            "scenario_probs": adjusted_probs,
            "scenario_probs_before_signals": llm_probs,
            "scenario_tariff_deltas": predictions.get(
                "scenario_tariff_deltas", DEFAULT_PREDICTIONS["scenario_tariff_deltas"]
            ),
            "reasoning": predictions.get("reasoning", DEFAULT_PREDICTIONS["reasoning"]),
        },
        "signals": {
            "signal_score": freq_result["signal_score"],
            "sentiment": freq_result["sentiment"],
            "velocity": freq_result["velocity"],
            "source_counts": freq_result["source_counts"],
            "top_signals": public_top_signals,
            "escalation_mass": freq_result["escalation_mass"],
            "deescalation_mass": freq_result["deescalation_mass"],
            "total_items": freq_result["total_items"],
            "bayesian_applied": True,
        },
        "policy_status": predictions.get("policy_status", DEFAULT_PREDICTIONS["policy_status"]),
        "alerts": predictions.get("alerts", DEFAULT_PREDICTIONS["alerts"]),
        "cost_impacts": cost_impacts,
        "news_headlines": news_headlines,
        "has_live_news": bool(news_headlines),
        "deadline_days": deadline_days,
        "timestamp": now.strftime("%Y-%m-%dT%H:%M:%SZ"),
    }

    return {
        "statusCode": 200,
        "headers": _cors_headers(),
        "body": json.dumps(payload),
    }
