from backend.kalshi_fetcher.handler import compute_cost_impacts
from unittest.mock import patch, MagicMock
import json


# --- Task 1: cost impact model ---

def test_compute_returns_all_categories():
    result = compute_cost_impacts([{"yes_price": 0.6}])
    assert set(result.keys()) == {"basics", "denim", "outerwear", "footwear", "accessories", "activewear"}


def test_compute_returns_p10_p50_p90():
    result = compute_cost_impacts([{"yes_price": 0.6}])
    for cat in result.values():
        assert set(cat.keys()) == {"p10", "p50", "p90"}


def test_empty_markets_returns_zero_p10():
    result = compute_cost_impacts([])
    assert result["basics"]["p10"] == 0.0


def test_price_clamped_above_one():
    result = compute_cost_impacts([{"yes_price": 1.5}])
    expected = compute_cost_impacts([{"yes_price": 1.0}])
    assert abs(result["basics"]["p90"] - expected["basics"]["p90"]) < 1e-10


def test_price_clamped_below_zero():
    result = compute_cost_impacts([{"yes_price": -0.3}])
    assert result["basics"]["p90"] >= 0.0


def test_p90_greater_than_p10():
    result = compute_cost_impacts([{"yes_price": 0.7}])
    for cat in result.values():
        assert cat["p90"] > cat["p10"]


# --- Task 2: lambda handler ---

MOCK_KALSHI_RESPONSE = {
    "markets": [
        {
            "ticker": "TARIFF-25",
            "title": "Will US tariffs on China exceed 50%?",
            "subtitle": "Section 301 tariff",
            "yes_price": 0.65,
            "close_time": "2026-12-31T00:00:00Z",
        },
        {
            "ticker": "UNRELATED",
            "title": "Will it rain in NYC?",
            "subtitle": "",
            "yes_price": 0.3,
            "close_time": "2026-12-31T00:00:00Z",
        },
    ]
}


def test_lambda_handler_filters_markets():
    from backend.kalshi_fetcher.handler import lambda_handler

    with patch("backend.kalshi_fetcher.handler.boto3") as mock_boto, \
         patch("backend.kalshi_fetcher.handler.requests") as mock_req:
        mock_boto.client.return_value.get_parameter.return_value = {
            "Parameter": {"Value": "fake-key"}
        }
        mock_req.get.return_value.json.return_value = MOCK_KALSHI_RESPONSE
        mock_req.get.return_value.raise_for_status = MagicMock()

        resp = lambda_handler({}, {})
        body = json.loads(resp["body"])

        assert resp["statusCode"] == 200
        assert len(body["markets"]) == 1
        assert body["markets"][0]["id"] == "TARIFF-25"


def test_lambda_handler_includes_cost_impacts():
    from backend.kalshi_fetcher.handler import lambda_handler

    with patch("backend.kalshi_fetcher.handler.boto3") as mock_boto, \
         patch("backend.kalshi_fetcher.handler.requests") as mock_req:
        mock_boto.client.return_value.get_parameter.return_value = {
            "Parameter": {"Value": "fake-key"}
        }
        mock_req.get.return_value.json.return_value = MOCK_KALSHI_RESPONSE
        mock_req.get.return_value.raise_for_status = MagicMock()

        resp = lambda_handler({}, {})
        body = json.loads(resp["body"])

        assert "cost_impacts" in body
        assert "basics" in body["cost_impacts"]


def test_lambda_handler_missing_ssm_returns_simulated_data():
    from backend.kalshi_fetcher.handler import lambda_handler

    with patch("backend.kalshi_fetcher.handler.boto3") as mock_boto:
        mock_boto.client.return_value.get_parameter.side_effect = Exception("ParameterNotFound")
        resp = lambda_handler({}, {})
        assert resp["statusCode"] == 200
        body = json.loads(resp["body"])
        assert body["simulated"] is True
        assert len(body["markets"]) > 0
        assert "cost_impacts" in body


def test_simulated_markets_have_valid_prices():
    from backend.kalshi_fetcher.handler import SIMULATED_MARKETS

    for m in SIMULATED_MARKETS:
        assert 0.0 <= m["yes_price"] <= 1.0, f"yes_price out of range for {m['id']}"


def test_lambda_handler_has_timestamp():
    from backend.kalshi_fetcher.handler import lambda_handler

    with patch("backend.kalshi_fetcher.handler.boto3") as mock_boto, \
         patch("backend.kalshi_fetcher.handler.requests") as mock_req:
        mock_boto.client.return_value.get_parameter.return_value = {
            "Parameter": {"Value": "fake-key"}
        }
        mock_req.get.return_value.json.return_value = {"markets": []}
        mock_req.get.return_value.raise_for_status = MagicMock()

        resp = lambda_handler({}, {})
        body = json.loads(resp["body"])
        assert "timestamp" in body
