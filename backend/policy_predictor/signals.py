"""
Signal aggregator + frequency-based probability model.

Sources:
  - NewsAPI (existing, keyed via SSM)
  - Federal Register API (executive orders, free, no key)
  - X / Twitter API v2 (optional, keyed via SSM)

Frequency model:
  - Recency-weighted term counting across all sources
  - Escalation vs de-escalation sentiment scoring
  - Bayesian probability adjustment on top of LLM priors
"""

import math
from datetime import datetime, timezone, timedelta

import requests

# ── Term dictionaries ────────────────────────────────────────────────────────

ESCALATION_TERMS = [
    "tariff increase", "new tariff", "tariff hike", "tariff expansion",
    "section 301", "executive order", "trade war", "reciprocal tariff",
    "trade restriction", "import ban", "sanctions", "retaliation",
    "escalation", "trade dispute", "tariff threat", "tariff action",
    "tariff announcement", "tariff proposal", "tariff measure",
]

DEESCALATION_TERMS = [
    "trade deal", "trade agreement", "tariff reduction", "tariff cut",
    "tariff relief", "tariff exemption", "tariff waiver", "negotiation",
    "trade talks", "bilateral agreement", "pause extended", "pause renewed",
    "de-escalation", "trade truce", "tariff suspension", "trade ceasefire",
]

NEUTRAL_TERMS = [
    "tariff", "trade policy", "import duty", "china trade", "us china",
    "apparel tariff", "textile tariff", "trade", "import", "customs",
    "trade balance", "trade deficit", "wto", "usmca", "trade legislation",
]

# High-authority sources get extra signal weight
HIGH_AUTHORITY_SOURCES = {
    "federal register", "white house", "ustr", "reuters", "ap news",
    "wall street journal", "financial times", "bloomberg", "politico",
}


# ── Federal Register (Executive Orders) ─────────────────────────────────────

def fetch_executive_orders(days_back: int = 90) -> list:
    """Fetch recent Presidential Documents mentioning tariffs from Federal Register."""
    start_date = (datetime.now(timezone.utc) - timedelta(days=days_back)).strftime("%m/%d/%Y")
    try:
        resp = requests.get(
            "https://api.federalregister.gov/v1/documents",
            params={
                "conditions[type][]": "PRESDOCU",
                "conditions[term]": "tariff apparel textile china trade import",
                "conditions[publication_date][gte]": start_date,
                "per_page": 10,
                "order": "newest",
                "fields[]": ["title", "publication_date", "document_number", "abstract", "type"],
            },
            timeout=6,
        )
        resp.raise_for_status()
        results = resp.json().get("results", [])
        now = datetime.now(timezone.utc)
        items = []
        for r in results[:8]:
            pub = r.get("publication_date", "")
            try:
                pub_dt = datetime.strptime(pub, "%Y-%m-%d").replace(tzinfo=timezone.utc)
                age_hours = (now - pub_dt).total_seconds() / 3600
            except Exception:
                age_hours = 24 * 30
            items.append({
                "text": (r.get("title", "") + " " + (r.get("abstract") or "")).lower(),
                "title": r.get("title", ""),
                "source": "Federal Register",
                "source_type": "executive_order",
                "published": pub,
                "age_hours": age_hours,
                "authority": 2.0,  # EOs carry double weight
            })
        return items
    except Exception:
        return []


# ── NewsAPI ──────────────────────────────────────────────────────────────────

def fetch_news(api_key: str) -> list:
    """Fetch recent news headlines about tariffs."""
    try:
        resp = requests.get(
            "https://newsapi.org/v2/everything",
            params={
                "q": (
                    'tariff OR "trade policy" OR "import duty" OR "Section 301" '
                    'OR "China trade" OR "executive order" tariff'
                ),
                "language": "en",
                "sortBy": "publishedAt",
                "pageSize": 15,
            },
            headers={"X-Api-Key": api_key},
            timeout=5,
        )
        resp.raise_for_status()
        articles = resp.json().get("articles", [])
        now = datetime.now(timezone.utc)
        items = []
        for a in articles[:12]:
            pub = a.get("publishedAt", "")
            try:
                pub_dt = datetime.fromisoformat(pub.replace("Z", "+00:00"))
                age_hours = (now - pub_dt).total_seconds() / 3600
            except Exception:
                age_hours = 24.0
            source_name = a.get("source", {}).get("name", "").lower()
            authority = 1.5 if source_name in HIGH_AUTHORITY_SOURCES else 1.0
            items.append({
                "text": (a.get("title", "") + " " + (a.get("description") or "")).lower(),
                "title": a.get("title", ""),
                "source": a.get("source", {}).get("name", ""),
                "source_type": "news",
                "published": pub[:10],
                "age_hours": age_hours,
                "authority": authority,
            })
        return items
    except Exception:
        return []


# ── X / Twitter API v2 ───────────────────────────────────────────────────────

def fetch_x_tweets(bearer_token: str, max_results: int = 50) -> list:
    """Fetch recent tweets about tariffs via Twitter API v2."""
    query = (
        "(tariff OR \"trade war\" OR \"section 301\" OR \"executive order\" tariff "
        "OR \"import duty\") (china OR apparel OR textile OR \"trade policy\") "
        "lang:en -is:retweet"
    )
    try:
        resp = requests.get(
            "https://api.twitter.com/2/tweets/search/recent",
            params={
                "query": query,
                "max_results": min(max_results, 100),
                "tweet.fields": "created_at,public_metrics",
            },
            headers={"Authorization": f"Bearer {bearer_token}"},
            timeout=8,
        )
        resp.raise_for_status()
        tweets = resp.json().get("data", [])
        now = datetime.now(timezone.utc)
        items = []
        for t in tweets:
            try:
                created = datetime.fromisoformat(
                    t.get("created_at", "").replace("Z", "+00:00")
                )
                age_hours = (now - created).total_seconds() / 3600
            except Exception:
                age_hours = 12.0
            metrics = t.get("public_metrics", {})
            engagement = metrics.get("like_count", 0) + metrics.get("retweet_count", 0) * 3
            # Weight high-engagement tweets up to 2× — viral signals matter more
            authority = min(2.0, 0.8 + (math.log1p(engagement) / 10))
            items.append({
                "text": t.get("text", "").lower(),
                "title": t.get("text", "")[:120],
                "source": "X/Twitter",
                "source_type": "tweet",
                "published": "",
                "age_hours": age_hours,
                "authority": authority,
                "engagement": engagement,
            })
        return items
    except Exception:
        return []


# ── Frequency model ──────────────────────────────────────────────────────────

def _recency_weight(age_hours: float, half_life_hours: float = 24.0) -> float:
    """Exponential decay: weight = 0.5^(age / half_life). Floor at 0.05."""
    return max(0.05, 0.5 ** (age_hours / half_life_hours))


def compute_frequency_model(signal_items: list) -> dict:
    """
    Runs frequency + sentiment analysis over all signal items.

    Returns:
        signal_score   : 0-1  — overall tariff discourse intensity
        sentiment      : -1 to +1  — negative=de-escalation, positive=escalation
        velocity       : "rising" | "stable" | "falling"
        source_counts  : {news: N, tweet: N, executive_order: N}
        top_signals    : top-5 items by weighted score
        escalation_mass: float — raw weighted escalation hits
        deescalation_mass: float
    """
    escalation_mass = 0.0
    deescalation_mass = 0.0
    total_signal = 0.0

    # For velocity: split into recent (0-24h) vs older (24-72h)
    recent_mass = 0.0
    older_mass = 0.0

    source_counts = {"news": 0, "tweet": 0, "executive_order": 0}
    scored_items = []

    for item in signal_items:
        text = item.get("text", "")
        age_hours = float(item.get("age_hours", 24.0))
        authority = float(item.get("authority", 1.0))
        source_type = item.get("source_type", "news")

        source_counts[source_type] = source_counts.get(source_type, 0) + 1

        rw = _recency_weight(age_hours) * authority

        esc_hits = sum(1 for t in ESCALATION_TERMS if t in text)
        desc_hits = sum(1 for t in DEESCALATION_TERMS if t in text)
        neutral_hits = sum(1 for t in NEUTRAL_TERMS if t in text)

        item_signal = rw * (esc_hits + desc_hits + neutral_hits * 0.3)
        item_esc = rw * esc_hits
        item_desc = rw * desc_hits

        escalation_mass += item_esc
        deescalation_mass += item_desc
        total_signal += item_signal

        if age_hours <= 24:
            recent_mass += item_signal
        else:
            older_mass += item_signal

        scored_items.append({
            "title": item.get("title", "")[:100],
            "source": item.get("source", ""),
            "source_type": source_type,
            "published": item.get("published", ""),
            "weight": round(item_signal, 3),
            "escalation": esc_hits,
            "deescalation": desc_hits,
        })

    # Normalize signal_score: 0=quiet, 1=very active
    # Calibrated so ~20 weighted signal units = score of 1.0
    signal_score = round(min(1.0, total_signal / 20.0), 3)

    # Sentiment
    combined = escalation_mass + deescalation_mass
    if combined > 0:
        sentiment = round((escalation_mass - deescalation_mass) / combined, 3)
    else:
        sentiment = 0.0

    # Velocity: compare recent vs older windows (normalized per hour)
    recent_rate = recent_mass / 24.0
    older_rate = older_mass / 48.0 if older_mass > 0 else recent_rate
    if older_rate == 0:
        velocity = "stable"
    elif recent_rate > older_rate * 1.4:
        velocity = "rising"
    elif recent_rate < older_rate * 0.6:
        velocity = "falling"
    else:
        velocity = "stable"

    # Top 5 signals by weight
    top_signals = sorted(scored_items, key=lambda x: x["weight"], reverse=True)[:5]

    return {
        "signal_score": signal_score,
        "sentiment": sentiment,
        "velocity": velocity,
        "source_counts": source_counts,
        "top_signals": top_signals,
        "escalation_mass": round(escalation_mass, 2),
        "deescalation_mass": round(deescalation_mass, 2),
        "total_items": len(signal_items),
    }


# ── Bayesian probability update ──────────────────────────────────────────────

def bayesian_update_probs(base_probs: dict, freq_result: dict) -> dict:
    """
    Adjust LLM-derived scenario probabilities using signal evidence.

    Logic:
      - High signal_score + escalation sentiment → shift mass toward P90
      - High signal_score + de-escalation sentiment → shift mass toward P10
      - Low signal_score or neutral → minimal adjustment
      - EO presence (authority=2.0 items) amplifies the shift
      - Maximum shift: ±20pp from base probs

    Returns updated {p10, p50, p90} that sum to 1.0.
    """
    p10 = float(base_probs.get("p10", 0.20))
    p50 = float(base_probs.get("p50", 0.55))
    p90 = float(base_probs.get("p90", 0.25))

    signal_score = float(freq_result.get("signal_score", 0.0))
    sentiment = float(freq_result.get("sentiment", 0.0))

    # Only adjust if signal is meaningful
    if signal_score < 0.08:
        return {
            "p10": round(p10, 3),
            "p50": round(p50, 3),
            "p90": round(p90, 3),
        }

    # Raw shift magnitude: signal_score drives how much, sentiment drives direction
    # Max shift = 20pp when signal=1.0 and sentiment=±1.0
    shift = signal_score * sentiment * 0.20

    if shift > 0:
        # Escalation signal → move mass from P10 → P90
        delta = min(shift, p10 * 0.6)      # can't take more than 60% of P10
        p90 = p90 + delta
        p10 = p10 - delta * 0.7
        p50 = p50 - delta * 0.3
    elif shift < 0:
        # De-escalation signal → move mass from P90 → P10
        delta = min(-shift, p90 * 0.6)
        p10 = p10 + delta
        p90 = p90 - delta * 0.7
        p50 = p50 - delta * 0.3

    # Clamp to sensible ranges
    p10 = max(0.05, min(0.70, p10))
    p90 = max(0.05, min(0.70, p90))
    p50 = max(0.05, min(0.80, p50))

    # Renormalize to 1.0
    total = p10 + p50 + p90
    return {
        "p10": round(p10 / total, 3),
        "p50": round(p50 / total, 3),
        "p90": round(p90 / total, 3),
    }


def format_signals_for_prompt(freq_result: dict, signal_items: list) -> str:
    """Format signal analysis into a compact LLM-readable string."""
    score = freq_result.get("signal_score", 0.0)
    sentiment = freq_result.get("sentiment", 0.0)
    velocity = freq_result.get("velocity", "stable")
    counts = freq_result.get("source_counts", {})
    top = freq_result.get("top_signals", [])

    sentiment_label = (
        "Escalation-biased" if sentiment > 0.2 else
        "De-escalation-biased" if sentiment < -0.2 else
        "Neutral"
    )
    intensity_label = (
        "Very High" if score > 0.75 else
        "High" if score > 0.5 else
        "Moderate" if score > 0.25 else
        "Low"
    )

    lines = [
        f"MULTI-SOURCE SIGNAL ANALYSIS (Frequency Model):",
        f"- Signal Intensity: {intensity_label} ({score:.0%}) | Velocity: {velocity.upper()} | Sentiment: {sentiment_label}",
        f"- Sources: {counts.get('news', 0)} news articles, {counts.get('tweet', 0)} tweets, {counts.get('executive_order', 0)} executive orders",
        f"- Escalation signal mass: {freq_result.get('escalation_mass', 0):.1f} | De-escalation: {freq_result.get('deescalation_mass', 0):.1f}",
    ]

    if top:
        lines.append("Top signals by recency-weighted frequency score:")
        for s in top[:4]:
            src = s.get("source", "")
            title = s.get("title", "")[:90]
            lines.append(f"  [{src}] {title}")

    return "\n".join(lines)
