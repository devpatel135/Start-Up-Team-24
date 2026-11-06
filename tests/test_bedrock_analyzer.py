from unittest.mock import patch, MagicMock
import json


def test_parse_risk_level_moderate():
    from backend.bedrock_analyzer.handler import parse_risk_level
    text = "Some summary.\n\nMore text.\n\nRISK_LEVEL: moderate"
    assert parse_risk_level(text) == "moderate"


def test_parse_risk_level_high():
    from backend.bedrock_analyzer.handler import parse_risk_level
    text = "Para1.\n\nPara2.\n\nRISK_LEVEL: high"
    assert parse_risk_level(text) == "high"


def test_parse_risk_level_missing_defaults_unknown():
    from backend.bedrock_analyzer.handler import parse_risk_level
    assert parse_risk_level("No risk level line here.") == "unknown"


def test_parse_risk_level_case_insensitive():
    from backend.bedrock_analyzer.handler import parse_risk_level
    assert parse_risk_level("RISK_LEVEL: Severe") == "severe"


def test_lambda_handler_bedrock_failure_returns_fallback():
    from backend.bedrock_analyzer.handler import lambda_handler

    with patch("backend.bedrock_analyzer.handler.boto3") as mock_boto:
        mock_boto.client.return_value.invoke_model.side_effect = Exception("ThrottlingException")
        resp = lambda_handler({"body": json.dumps({"markets": [], "cost_impacts": {}})}, {})
        body = json.loads(resp["body"])
        assert resp["statusCode"] == 200
        assert body["risk_level"] == "unknown"
        assert "unavailable" in body["summary"].lower()


def test_lambda_handler_success():
    from backend.bedrock_analyzer.handler import lambda_handler

    mock_response_body = json.dumps({
        "content": [{"text": "Prediction markets signal significant escalation risk over the next 90 days.\n\nBuyers should consider splitting orders between Vietnam and domestic suppliers to hedge exposure.\n\nRISK_LEVEL: high"}]
    }).encode()

    with patch("backend.bedrock_analyzer.handler.boto3") as mock_boto:
        mock_boto.client.return_value.invoke_model.return_value = {
            "body": MagicMock(read=lambda: mock_response_body)
        }
        resp = lambda_handler(
            {"body": json.dumps({
                "markets": [{"title": "Tariff?", "yes_price": 0.7}],
                "cost_impacts": {"basics": {"p10": 0.01, "p50": 0.04, "p90": 0.09}}
            })},
            {}
        )
        body = json.loads(resp["body"])
        assert resp["statusCode"] == 200
        assert body["risk_level"] == "high"
        assert len(body["summary"]) > 20


def test_lambda_handler_empty_body_uses_defaults():
    from backend.bedrock_analyzer.handler import lambda_handler

    mock_response_body = json.dumps({
        "content": [{"text": "Summary.\n\nDetail.\n\nRISK_LEVEL: low"}]
    }).encode()

    with patch("backend.bedrock_analyzer.handler.boto3") as mock_boto:
        mock_boto.client.return_value.invoke_model.return_value = {
            "body": MagicMock(read=lambda: mock_response_body)
        }
        resp = lambda_handler({"body": "{}"}, {})
        assert resp["statusCode"] == 200
