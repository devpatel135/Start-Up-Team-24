import json
import re
from datetime import datetime, timezone

import boto3
import requests

CATEGORY_PROFILES = {
    "basics":     {"china_pct": 0.72, "import_factor": 0.28, "base_rate": 0.167},
    "denim":      {"china_pct": 0.45, "import_factor": 0.22, "base_rate": 0.168},
    "outerwear":  {"china_pct": 0.58, "import_factor": 0.32, "base_rate": 0.278},
    "footwear":   {"china_pct": 0.65, "import_factor": 0.35, "base_rate": 0.200},
    "accessories":{"china_pct": 0.68, "import_factor": 0.25, "base_rate": 0.147},
    "activewear": {"china_pct": 0.55, "import_factor": 0.30, "base_rate": 0.167},
}

SCENARIOS = {
    "p10": 0.00,   # optimistic: no tariff increase
    "p50": 0.15,   # moderate: +15 percentage points on base rate
    "p90": 0.35,   # severe: +35 percentage points on base rate
}

TRADE_KEYWORDS = ["tariff", "trade", "import duty", "china", "section 301", "mfn", "usmca"]

KALSHI_API_BASE = "https://trading-api.kalshi.com/trade-api/v2"


def compute_cost_impacts(markets: list) -> dict:
    prices = [max(0.0, min(1.0, m["yes_price"])) for m in markets if "yes_price" in m]
    avg_prob = sum(prices) / len(prices) if prices else 0.5

    result = {}
    for category, profile in CATEGORY_PROFILES.items():
        cat_impacts = {}
        for scenario_key, scenario_rate in SCENARIOS.items():
            delta = profile["china_pct"] * profile["import_factor"] * scenario_rate
            cat_impacts[scenario_key] = round(delta * avg_prob, 4)
        result[category] = cat_impacts
    return result


def _is_trade_related(market: dict) -> bool:
    text = (market.get("title", "") + " " + market.get("subtitle", "")).lower()
    return any(kw in text for kw in TRADE_KEYWORDS)


def fetch_kalshi_markets(api_key: str) -> list:
    resp = requests.get(
        f"{KALSHI_API_BASE}/markets",
        params={"status": "open", "limit": 100},
        headers={"Authorization": f"Bearer {api_key}"},
        timeout=10,
    )
    resp.raise_for_status()
    all_markets = resp.json().get("markets", [])
    filtered = [m for m in all_markets if _is_trade_related(m)]
    return [
        {
            "id": m.get("ticker", ""),
            "title": m.get("title", ""),
            "yes_price": m.get("yes_price", 0.5),
            "expiry": m.get("close_time", ""),
        }
        for m in filtered
    ]


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
        ssm = boto3.client("ssm", region_name="us-east-1")
        param = ssm.get_parameter(
            Name="/trade-policy-tool/kalshi-api-key", WithDecryption=True
        )
        api_key = param["Parameter"]["Value"]
    except Exception as e:
        return {
            "statusCode": 500,
            "headers": _cors_headers(),
            "body": json.dumps({"error": f"SSM parameter /trade-policy-tool/kalshi-api-key not found: {str(e)}"}),
        }

    try:
        markets = fetch_kalshi_markets(api_key)
        cost_impacts = compute_cost_impacts(markets)
        payload = {
            "markets": markets,
            "cost_impacts": cost_impacts,
            "timestamp": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        }
        return {
            "statusCode": 200,
            "headers": _cors_headers(),
            "body": json.dumps(payload),
        }
    except Exception as e:
        return {
            "statusCode": 500,
            "headers": _cors_headers(),
            "body": json.dumps({"error": str(e)}),
        }
