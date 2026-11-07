import json
from unittest.mock import patch, MagicMock


def test_compute_cost_impacts_all_categories():
    from backend.policy_predictor.handler import compute_cost_impacts
    preds = {"scenario_tariff_deltas": {"p10": 0.0, "p50": 0.15, "p90": 0.35}}
    result = compute_cost_impacts(preds)
    assert set(result.keys()) == {"basics", "denim", "outerwear", "footwear", "accessories", "activewear"}


def test_compute_cost_impacts_all_scenarios():
    from backend.policy_predictor.handler import compute_cost_impacts
    preds = {"scenario_tariff_deltas": {"p10": 0.0, "p50": 0.15, "p90": 0.35}}
    result = compute_cost_impacts(preds)
    for cat in result.values():
        assert set(cat.keys()) == {"p10", "p50", "p90"}


def test_compute_cost_impacts_zero_delta_gives_zero():
    from backend.policy_predictor.handler import compute_cost_impacts
    preds = {"scenario_tariff_deltas": {"p10": 0.0, "p50": 0.0, "p90": 0.0}}
    result = compute_cost_impacts(preds)
    for cat in result.values():
        for val in cat.values():
            assert val == 0.0


def test_compute_cost_impacts_negative_delta_clamps_to_zero():
    from backend.policy_predictor.handler import compute_cost_impacts
    preds = {"scenario_tariff_deltas": {"p10": -0.10, "p50": 0.0, "p90": 0.20}}
    result = compute_cost_impacts(preds)
    for cat in result.values():
        assert cat["p10"] >= 0.0


def test_default_predictions_scenario_probs_sum_to_one():
    from backend.policy_predictor.handler import DEFAULT_PREDICTIONS
    probs = DEFAULT_PREDICTIONS["scenario_probs"]
    assert abs(sum(probs.values()) - 1.0) < 0.02


def test_lambda_handler_no_ssm_still_returns_200():
    from backend.policy_predictor.handler import lambda_handler
    with patch("backend.policy_predictor.handler.boto3") as mock_boto:
        mock_boto.client.return_value.get_parameter.side_effect = Exception("not found")
        mock_boto.client.return_value.invoke_model.side_effect = Exception("bedrock unavailable")

        resp = lambda_handler({}, {})
        assert resp["statusCode"] == 200


def test_lambda_handler_bedrock_failure_returns_default_predictions():
    from backend.policy_predictor.handler import lambda_handler
    with patch("backend.policy_predictor.handler.boto3") as mock_boto:
        mock_boto.client.return_value.get_parameter.side_effect = Exception("not found")
        mock_boto.client.return_value.invoke_model.side_effect = Exception("bedrock unavailable")

        resp = lambda_handler({}, {})
        body = json.loads(resp["body"])
        assert resp["statusCode"] == 200
        assert "policy_status" in body
        assert "alerts" in body
        assert "cost_impacts" in body


def test_lambda_handler_response_has_policy_status():
    from backend.policy_predictor.handler import lambda_handler
    with patch("backend.policy_predictor.handler.boto3") as mock_boto:
        mock_boto.client.return_value.get_parameter.side_effect = Exception("not found")
        mock_boto.client.return_value.invoke_model.side_effect = Exception("bedrock unavailable")

        resp = lambda_handler({}, {})
        body = json.loads(resp["body"])
        assert len(body["policy_status"]) > 0
        first = body["policy_status"][0]
        assert "id" in first
        assert "risk" in first
        assert "direction" in first


def test_lambda_handler_response_has_alerts():
    from backend.policy_predictor.handler import lambda_handler
    with patch("backend.policy_predictor.handler.boto3") as mock_boto:
        mock_boto.client.return_value.get_parameter.side_effect = Exception("not found")
        mock_boto.client.return_value.invoke_model.side_effect = Exception("bedrock unavailable")

        resp = lambda_handler({}, {})
        body = json.loads(resp["body"])
        assert len(body["alerts"]) > 0
        first = body["alerts"][0]
        assert "severity" in first
        assert "title" in first
        assert "detail" in first
