import json
import re

import boto3

BEDROCK_MODEL_ID = "anthropic.claude-3-5-sonnet-20241022-v2:0"
BEDROCK_REGION = "us-east-1"

PROMPT_TEMPLATE = """You are a senior trade risk analyst advising a US retail apparel buyer who must commit Spring 2027 purchase orders by March 1, 2027.

CURRENT TARIFF ENVIRONMENT (as of late 2025):
- China: 145% effective tariff rate in force (10% emergency base + 125% reciprocal Section 301). No pause — fully active.
- Vietnam: 46% reciprocal tariff announced; 90-day pause active (10% interim). Pause could expire before Spring 2027 orders ship.
- Bangladesh: 37% reciprocal tariff announced; 90-day pause active (10% interim). Same expiry risk as Vietnam.
- Mexico (USMCA): 0% — only major apparel origin fully exempt from April 2025 trade actions.

SCENARIO PROBABILITY ESTIMATES (Bayesian-adjusted from live signals):
{scenarios_summary}

LANDED COST IMPACTS BY CATEGORY:
{cost_impacts_summary}

ACTIVE ALERTS:
{alerts_summary}

REAL-TIME SIGNAL ANALYSIS:
{signals_summary}

Write exactly two paragraphs:
1. What the scenario probabilities and the 145% China tariff situation signal about trade risk for retail apparel buyers entering Spring 2027 order commitments — reference the specific cost impact percentages.
2. What this means practically for a clothing buyer with order deadlines approaching — specific, actionable, no hedging. Reference the margin erosion numbers and name specific actions.

After the two paragraphs, output on a new line: RISK_LEVEL: low|moderate|high|severe
(based on P50 average cost impact: <2% = low, 2-5% = moderate, 5-10% = high, >10% = severe)

Then output on a new line: RECOMMENDATIONS:
Followed by exactly 3 bullet points, each starting with "- ", that give specific, numbered action steps for the retail apparel buyer given their Spring 2027 commitment window."""

FALLBACK_SUMMARY = (
    "AI analysis temporarily unavailable. Review the scenario probability estimates "
    "and policy status table for current trade risk conditions."
)

FALLBACK_RECOMMENDATIONS = [
    "Audit China-sourced inventory exposure across all categories and quantify P50 cost impact as a percentage of gross margin.",
    "Contact key suppliers in Vietnam and Bangladesh to confirm capacity and lead times for order diversification.",
    "Model price-pass-through scenarios for the top 3 categories before placing Q2 purchase orders.",
]


def parse_risk_level(text: str) -> str:
    match = re.search(r"RISK_LEVEL:\s*(low|moderate|high|severe)", text, re.IGNORECASE)
    if match:
        return match.group(1).lower()
    return "unknown"


def _parse_recommendations(text: str) -> list:
    if "RECOMMENDATIONS:" not in text.upper():
        return FALLBACK_RECOMMENDATIONS
    parts = re.split(r"RECOMMENDATIONS:", text, flags=re.IGNORECASE, maxsplit=1)
    if len(parts) < 2:
        return FALLBACK_RECOMMENDATIONS
    rec_block = parts[1].strip()
    items = [
        line.lstrip("- •").strip()
        for line in rec_block.split("\n")
        if line.strip().startswith("-") or line.strip().startswith("•")
    ]
    return items[:3] if items else FALLBACK_RECOMMENDATIONS


def _format_scenarios(predictions: dict) -> str:
    if not predictions:
        return "No scenario data available."
    probs = predictions.get("scenario_probs", {})
    deltas = predictions.get("scenario_tariff_deltas", {})
    lines = []
    for scenario in ("p10", "p50", "p90"):
        label = {"p10": "Optimistic", "p50": "Moderate", "p90": "Severe"}[scenario]
        prob_pct = int(probs.get(scenario, 0) * 100)
        delta_pct = deltas.get(scenario, 0) * 100
        lines.append(f"- {label} ({scenario.upper()}): {prob_pct}% probability, +{delta_pct:.0f}pp tariff delta")
    reasoning = predictions.get("reasoning", "")
    if reasoning:
        lines.append(f"\nReasoning: {reasoning}")
    return "\n".join(lines)


def _format_cost_impacts(cost_impacts: dict) -> str:
    if not cost_impacts:
        return "No cost impact data available."
    lines = []
    for category, impacts in cost_impacts.items():
        p50 = impacts.get("p50", 0)
        p90 = impacts.get("p90", 0)
        lines.append(f"- {category.capitalize()}: P50 impact {p50*100:.1f}%, P90 impact {p90*100:.1f}%")
    return "\n".join(lines)


def _format_alerts(alerts: list) -> str:
    if not alerts:
        return "No active alerts."
    lines = []
    for alert in alerts[:4]:
        severity = alert.get("severity", "info").upper()
        title = alert.get("title", "")
        lines.append(f"- [{severity}] {title}")
    return "\n".join(lines)


def _format_signals(signals: dict) -> str:
    if not signals:
        return "No signal data available."
    score = signals.get("signal_score", 0.0)
    sentiment = signals.get("sentiment", 0.0)
    velocity = signals.get("velocity", "stable")
    counts = signals.get("source_counts", {})
    top = signals.get("top_signals", [])

    intensity = (
        "Very High" if score > 0.75 else
        "High" if score > 0.5 else
        "Moderate" if score > 0.25 else "Low"
    )
    sentiment_label = (
        "Escalation-biased" if sentiment > 0.2 else
        "De-escalation-biased" if sentiment < -0.2 else "Neutral"
    )
    lines = [
        f"Signal Intensity: {intensity} ({score:.0%}) | Velocity: {velocity.upper()} | Sentiment: {sentiment_label}",
        f"Sources: {counts.get('news', 0)} news, {counts.get('tweet', 0)} tweets, {counts.get('executive_order', 0)} executive orders",
    ]
    if top:
        lines.append("Top signals:")
        for s in top[:3]:
            lines.append(f"  [{s.get('source', '')}] {s.get('title', '')[:80]}")
    return "\n".join(lines)


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

    try:
        body = json.loads(event.get("body", "{}") or "{}")
        predictions = body.get("predictions", {})
        cost_impacts = body.get("cost_impacts", {})
        alerts = body.get("alerts", [])
        signals = body.get("signals", {})

        prompt = PROMPT_TEMPLATE.format(
            scenarios_summary=_format_scenarios(predictions),
            cost_impacts_summary=_format_cost_impacts(cost_impacts),
            alerts_summary=_format_alerts(alerts),
            signals_summary=_format_signals(signals),
        )

        client = boto3.client("bedrock-runtime", region_name=BEDROCK_REGION)
        response = client.invoke_model(
            modelId=BEDROCK_MODEL_ID,
            body=json.dumps({
                "anthropic_version": "bedrock-2023-05-31",
                "max_tokens": 600,
                "messages": [{"role": "user", "content": prompt}],
            }),
            contentType="application/json",
            accept="application/json",
        )

        response_body = json.loads(response["body"].read())
        full_text = response_body["content"][0]["text"]

        # Strip RISK_LEVEL and RECOMMENDATIONS lines from the visible summary
        summary_lines = [
            line for line in full_text.split("\n")
            if not line.strip().upper().startswith("RISK_LEVEL:")
            and not line.strip().upper().startswith("RECOMMENDATIONS:")
            and not (line.strip().startswith("-") and "RECOMMENDATIONS:" in full_text.upper()
                     and full_text.upper().index("RECOMMENDATIONS:") < full_text.find(line))
        ]
        summary = "\n".join(summary_lines).strip()
        risk_level = parse_risk_level(full_text)
        recommendations = _parse_recommendations(full_text)

        return {
            "statusCode": 200,
            "headers": _cors_headers(),
            "body": json.dumps({
                "summary": summary,
                "risk_level": risk_level,
                "recommendations": recommendations,
            }),
        }

    except Exception:
        return {
            "statusCode": 200,
            "headers": _cors_headers(),
            "body": json.dumps({
                "summary": FALLBACK_SUMMARY,
                "risk_level": "unknown",
                "recommendations": FALLBACK_RECOMMENDATIONS,
            }),
        }
