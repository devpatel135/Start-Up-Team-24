import json
import re

import boto3

BEDROCK_MODEL_ID = "anthropic.claude-3-5-sonnet-20241022-v2:0"
BEDROCK_REGION = "us-east-1"

PROMPT_TEMPLATE = """You are a trade risk analyst for a retail clothing buyer.

Given these Kalshi prediction market results on trade policy:
{markets_summary}

And these probability-weighted landed cost impacts per apparel category:
{cost_impacts_summary}

Write exactly two paragraphs:
1. What the prediction markets are collectively signaling about trade policy risk over the next 90 days.
2. What this means practically for a clothing buyer with order deadlines in the next 90 days — specific, actionable, no hedging.

After the two paragraphs, output on a new line: RISK_LEVEL: low|moderate|high|severe
(based on P50 average cost impact: <2% = low, 2-5% = moderate, 5-10% = high, >10% = severe)"""

FALLBACK_SUMMARY = (
    "Analysis temporarily unavailable. Review Kalshi market data directly "
    "for current trade policy probabilities."
)


def parse_risk_level(text: str) -> str:
    match = re.search(r"RISK_LEVEL:\s*(low|moderate|high|severe)", text, re.IGNORECASE)
    if match:
        return match.group(1).lower()
    return "unknown"


def _format_markets(markets: list) -> str:
    if not markets:
        return "No trade-related markets found on Kalshi at this time."
    lines = []
    for m in markets[:10]:
        prob = int(m.get("yes_price", 0) * 100)
        lines.append(f"- {m.get('title', 'Unknown market')}: {prob}% probability (expires {m.get('expiry', 'N/A')[:10]})")
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
        markets = body.get("markets", [])
        cost_impacts = body.get("cost_impacts", {})

        prompt = PROMPT_TEMPLATE.format(
            markets_summary=_format_markets(markets),
            cost_impacts_summary=_format_cost_impacts(cost_impacts),
        )

        client = boto3.client("bedrock-runtime", region_name=BEDROCK_REGION)
        response = client.invoke_model(
            modelId=BEDROCK_MODEL_ID,
            body=json.dumps({
                "anthropic_version": "bedrock-2023-05-31",
                "max_tokens": 400,
                "messages": [{"role": "user", "content": prompt}],
            }),
            contentType="application/json",
            accept="application/json",
        )

        response_body = json.loads(response["body"].read())
        full_text = response_body["content"][0]["text"]

        # Strip the RISK_LEVEL line from the visible summary
        summary_lines = [
            line for line in full_text.split("\n")
            if not line.strip().upper().startswith("RISK_LEVEL:")
        ]
        summary = "\n".join(summary_lines).strip()
        risk_level = parse_risk_level(full_text)

        return {
            "statusCode": 200,
            "headers": _cors_headers(),
            "body": json.dumps({"summary": summary, "risk_level": risk_level}),
        }

    except Exception as e:
        return {
            "statusCode": 200,  # Return 200 with fallback so UI can still render
            "headers": _cors_headers(),
            "body": json.dumps({"summary": FALLBACK_SUMMARY, "risk_level": "unknown"}),
        }
