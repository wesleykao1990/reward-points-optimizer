#!/usr/bin/env python3
"""Offline validator for Japan Rewards Optimizer Foundation Package v0.4.1.

The validator performs no network requests. It validates JSON Schema, examples,
registries, cross-references, semantic invariants, the prompt-injection fixture,
source-maintenance configuration, and load-bearing SQL structure. It does not
replace execution against PostgreSQL 15+.
"""

from __future__ import annotations

import copy
import json
import re
import sys
from collections import Counter, defaultdict
from datetime import datetime
from decimal import Decimal
from pathlib import Path
from typing import Any, Iterable
from urllib.parse import urlparse

import yaml
from jsonschema import Draft202012Validator, FormatChecker
from referencing import Registry, Resource

BASE = Path(__file__).resolve().parents[1]
SCHEMA_DIR = BASE / "schemas"
EXPECTED_SCHEMA_FILES = {
    "asset.schema.json",
    "evidence-record.schema.json",
    "extraction-candidate.schema.json",
    "golden-scenario.schema.json",
    "purchase-plan.schema.json",
    "reward-rule.schema.json",
    "source-access-observation.schema.json",
    "source-observation.schema.json",
    "trusted-source-registry.schema.json",
    "trusted-source.schema.json",
    "user-state.schema.json",
}
EXPECTED_SOURCE_COUNT = 140
EXPECTED_SCENARIO_COUNT = 100
EXPECTED_LEVELS = Counter(
    {"L1_SINGLE_RULE": 40, "L2_STACKING": 40, "L3_ADVERSARIAL": 20}
)


class ValidationFailure(AssertionError):
    pass


def fail(message: str) -> None:
    raise ValidationFailure(message)


def load_json(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


def load_yaml(path: Path) -> Any:
    return yaml.safe_load(path.read_text(encoding="utf-8"))


def parse_dt(value: str | None, label: str) -> datetime | None:
    if value is None:
        return None
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError as exc:
        fail(f"{label}: invalid ISO timestamp {value!r}: {exc}")


def duplicate_values(values: Iterable[str]) -> list[str]:
    counts = Counter(values)
    return sorted(value for value, count in counts.items() if count > 1)


def build_schema_registry(schemas: dict[str, dict[str, Any]]) -> Registry:
    resources: list[tuple[str, Resource[Any]]] = []
    for name, schema in schemas.items():
        try:
            Draft202012Validator.check_schema(schema)
        except Exception as exc:  # pragma: no cover - error path only
            fail(f"Invalid JSON Schema {name}: {exc}")
        resources.append((schema["$id"], Resource.from_contents(schema)))
    return Registry().with_resources(resources)


def validate_schema(
    instance: Any,
    schema: dict[str, Any],
    registry: Registry,
    label: str,
) -> None:
    validator = Draft202012Validator(
        schema,
        registry=registry,
        format_checker=FormatChecker(),
    )
    errors = sorted(
        validator.iter_errors(instance),
        key=lambda error: [str(part) for part in error.absolute_path],
    )
    if not errors:
        return
    rendered: list[str] = []
    for error in errors:
        path = "/".join(str(part) for part in error.absolute_path) or "<root>"
        rendered.append(f"{label}:{path}: {error.message}")
        for suberror in sorted(error.context, key=lambda item: item.message)[:4]:
            subpath = "/".join(str(part) for part in suberror.absolute_path) or path
            rendered.append(f"  {label}:{subpath}: {suberror.message}")
    fail("\n".join(rendered))


def validate_all_serialized_files() -> None:
    for path in sorted(BASE.rglob("*")):
        if not path.is_file() or "__pycache__" in path.parts:
            continue
        if path.suffix == ".json":
            load_json(path)
        elif path.suffix in {".yaml", ".yml"}:
            load_yaml(path)


def validate_value_range(value: dict[str, Any], label: str) -> None:
    minimum = value["minimum_jpy"]
    maximum = value["maximum_jpy"]
    if minimum > maximum:
        fail(f"{label}: minimum_jpy exceeds maximum_jpy")
    expected = value.get("expected_jpy")
    if expected is not None and not minimum <= expected <= maximum:
        fail(f"{label}: expected_jpy is outside the minimum/maximum range")


def exact_value(value: dict[str, Any]) -> int | None:
    if value["minimum_jpy"] == value["maximum_jpy"]:
        return value["minimum_jpy"]
    return None


def validate_asset_lot(lot: dict[str, Any], label: str) -> None:
    if Decimal(lot["quantity"]["amount"]) < 0:
        fail(f"{label}: negative asset quantity")
    expiry = lot["expiry"]
    if expiry["policy"] == "fixed_date" and expiry.get("expires_at") is None:
        fail(f"{label}: fixed_date expiry requires expires_at")
    if expiry["policy"] == "relative_to_posting" and expiry.get("duration_days") is None:
        fail(f"{label}: relative_to_posting expiry requires duration_days")


def purchase_signature(plan: dict[str, Any]) -> list[tuple[Any, ...]]:
    signatures: list[tuple[Any, ...]] = []
    for operation in plan["operations"]:
        if operation["operation_type"] != "merchant_purchase":
            continue
        line_items = tuple(
            sorted(
                (
                    item["product_class"],
                    item["amount_jpy"],
                    item["quantity"],
                )
                for item in operation["line_items"]
            )
        )
        signatures.append(
            (
                operation["merchant_id"],
                operation["merchant_location_id"],
                operation["channel"],
                operation["amount_jpy"],
                line_items,
            )
        )
    return signatures


def validate_plan(
    plan: dict[str, Any],
    label: str,
    opening_lot_ids: set[str] | None = None,
) -> None:
    opening_lot_ids = opening_lot_ids or set()
    operations = plan["operations"]
    operation_ids = [operation["operation_id"] for operation in operations]
    duplicates = duplicate_values(operation_ids)
    if duplicates:
        fail(f"{label}: duplicate operation IDs {duplicates}")
    sequences = [operation["sequence"] for operation in operations]
    if len(set(sequences)) != len(sequences):
        fail(f"{label}: operation sequence values must be unique")
    by_id = {operation["operation_id"]: operation for operation in operations}
    seq = {operation["operation_id"]: operation["sequence"] for operation in operations}

    ordered = sorted(operations, key=lambda item: item["sequence"])
    timestamps = [parse_dt(operation["occurred_at"], f"{label}/{operation['operation_id']}/occurred_at") for operation in ordered]
    if any(left is not None and right is not None and left > right for left, right in zip(timestamps, timestamps[1:])):
        fail(f"{label}: operation timestamps move backward relative to sequence")

    for dependency in plan["dependencies"]:
        source = dependency["from_operation_id"]
        target = dependency["to_operation_id"]
        if source not in by_id or target not in by_id:
            fail(f"{label}: dependency {source}->{target} references an unknown operation")
        if seq[source] >= seq[target]:
            fail(f"{label}: dependency {source}->{target} does not follow operation order")

    created_lots: dict[str, int] = {}
    seen_input_ids: set[str] = set()
    seen_output_ids: set[str] = set()
    for operation in ordered:
        original = operation.get("original_operation_id")
        if original is not None:
            if original not in by_id:
                fail(f"{label}/{operation['operation_id']}: unknown original_operation_id {original}")
            if seq[original] >= operation["sequence"]:
                fail(f"{label}/{operation['operation_id']}: original operation must occur earlier")

        for asset_input in operation["asset_inputs"]:
            input_id = asset_input["input_id"]
            if input_id in seen_input_ids:
                fail(f"{label}: duplicate asset input ID {input_id}")
            seen_input_ids.add(input_id)
            source_lot = asset_input["source_lot_id"]
            role = asset_input["role"]
            if role == "external_funding" and source_lot is not None:
                fail(f"{label}/{operation['operation_id']}/{input_id}: external funding must not masquerade as an internal asset lot")
            if source_lot is not None:
                if source_lot not in opening_lot_ids and source_lot not in created_lots:
                    fail(f"{label}/{operation['operation_id']}/{input_id}: unknown source lot {source_lot}")
                if source_lot in created_lots and created_lots[source_lot] >= operation["sequence"]:
                    fail(f"{label}/{operation['operation_id']}/{input_id}: source lot is consumed before creation")
            if Decimal(asset_input["quantity"]["amount"]) < 0:
                fail(f"{label}/{operation['operation_id']}/{input_id}: negative input quantity")

        for output in operation["output_requests"]:
            request_id = output["request_id"]
            lot_id = output["created_lot_id"]
            if request_id in seen_output_ids:
                fail(f"{label}: duplicate output request ID {request_id}")
            seen_output_ids.add(request_id)
            if lot_id in opening_lot_ids or lot_id in created_lots:
                fail(f"{label}: duplicate created asset-lot ID {lot_id}")
            created_lots[lot_id] = operation["sequence"]
            if output["requested_amount"] is not None and Decimal(output["requested_amount"]) < 0:
                fail(f"{label}/{operation['operation_id']}/{request_id}: negative output quantity")

        if operation["operation_type"] == "merchant_purchase":
            line_total = sum(item["amount_jpy"] for item in operation["line_items"])
            if operation["amount_jpy"] != line_total:
                fail(f"{label}/{operation['operation_id']}: line-item amount does not reconcile to operation amount")

    presentment_keys = [
        (row["operation_id"], row["loyalty_program_id"], row["sequence"])
        for row in plan["loyalty_presentments"]
    ]
    if len(set(presentment_keys)) != len(presentment_keys):
        fail(f"{label}: duplicate loyalty presentment")
    for presentment in plan["loyalty_presentments"]:
        if presentment["operation_id"] not in by_id:
            fail(f"{label}: loyalty presentment references unknown operation")


def _decimal_bound(value: Any, label: str) -> Decimal:
    if isinstance(value, bool) or not isinstance(value, (int, str)):
        fail(f"{label}: comparable bound must be an integer or decimal string")
    try:
        return Decimal(str(value))
    except Exception as exc:
        fail(f"{label}: invalid comparable numeric bound {value!r}: {exc}")


def validate_user_state(state: dict[str, Any], label: str) -> None:
    for key, fact in state["facts"].items():
        status = fact["status"]
        if status == "known" and "value" not in fact:
            fail(f"{label}/facts/{key}: known fact requires value")
        if status == "estimated":
            if fact.get("lower_bound") is None or fact.get("upper_bound") is None:
                fail(f"{label}/facts/{key}: estimated fact requires non-null lower and upper bounds")
            lower = _decimal_bound(fact["lower_bound"], f"{label}/facts/{key}/lower_bound")
            upper = _decimal_bound(fact["upper_bound"], f"{label}/facts/{key}/upper_bound")
            if lower > upper:
                fail(f"{label}/facts/{key}: estimated lower bound exceeds upper bound")
            if fact.get("observed_at") is None:
                fail(f"{label}/facts/{key}: estimated fact requires observed_at")

    for key, progress in state["cap_progress"].items():
        status = progress["status"]
        period_start = parse_dt(progress.get("period_start"), f"{label}/cap_progress/{key}/period_start")
        period_end = parse_dt(progress.get("period_end"), f"{label}/cap_progress/{key}/period_end")
        if period_start is not None and period_end is not None and period_end <= period_start:
            fail(f"{label}/cap_progress/{key}: period_end must be after period_start")
        if status in {"known", "estimated"}:
            required = (
                "eligible_spend_jpy_min",
                "eligible_spend_jpy_max",
                "reward_earned_units_min",
                "reward_earned_units_max",
            )
            if any(progress.get(field) is None for field in required):
                fail(f"{label}/cap_progress/{key}: {status} progress requires complete bounds")
            if progress.get("observed_at") is None:
                fail(f"{label}/cap_progress/{key}: {status} progress requires observed_at")
            if progress["eligible_spend_jpy_min"] > progress["eligible_spend_jpy_max"]:
                fail(f"{label}/cap_progress/{key}: spend lower bound exceeds upper bound")
            if Decimal(progress["reward_earned_units_min"]) > Decimal(progress["reward_earned_units_max"]):
                fail(f"{label}/cap_progress/{key}: reward lower bound exceeds upper bound")
            if status == "known" and (
                progress["eligible_spend_jpy_min"] != progress["eligible_spend_jpy_max"]
                or Decimal(progress["reward_earned_units_min"]) != Decimal(progress["reward_earned_units_max"])
            ):
                fail(f"{label}/cap_progress/{key}: known progress must have equal lower/upper bounds")

    lot_ids = [lot["lot_id"] for lot in state["asset_lots"]]
    if duplicate_values(lot_ids):
        fail(f"{label}: duplicate opening asset-lot IDs")
    for index, lot in enumerate(state["asset_lots"]):
        validate_asset_lot(lot, f"{label}/asset_lots/{index}")


def expect_semantic_failure(callable_: Any, expected_fragment: str, label: str) -> None:
    try:
        callable_()
    except ValidationFailure as exc:
        if expected_fragment not in str(exc):
            fail(f"{label}: failed for the wrong reason: {exc}")
        return
    fail(f"{label}: expected semantic validation failure")


def validate_semantic_self_tests(valid_state: dict[str, Any]) -> None:
    estimated_fact = copy.deepcopy(valid_state)
    estimated_fact["facts"]["semantic.range"] = {
        "status": "estimated",
        "value": None,
        "lower_bound": "10",
        "upper_bound": "5",
        "observed_at": "2026-08-17T12:00:00+09:00",
        "source": "user_input",
        "confidence": "0.5",
    }
    expect_semantic_failure(
        lambda: validate_user_state(estimated_fact, "semantic-self-test/estimated-fact"),
        "lower bound exceeds upper bound",
        "estimated fact ordering",
    )

    cap_reversed = copy.deepcopy(valid_state)
    cap_reversed["cap_progress"]["semantic.cap"] = {
        "status": "estimated",
        "eligible_spend_jpy_min": 100,
        "eligible_spend_jpy_max": 50,
        "reward_earned_units_min": "1",
        "reward_earned_units_max": "2",
        "period_start": "2026-08-01T00:00:00+09:00",
        "period_end": "2026-09-01T00:00:00+09:00",
        "observed_at": "2026-08-17T12:00:00+09:00",
        "source": "user_input",
    }
    expect_semantic_failure(
        lambda: validate_user_state(cap_reversed, "semantic-self-test/cap-reversed"),
        "spend lower bound exceeds upper bound",
        "cap ordering",
    )

    cap_known_unequal = copy.deepcopy(valid_state)
    cap_known_unequal["cap_progress"]["semantic.known"] = {
        "status": "known",
        "eligible_spend_jpy_min": 50,
        "eligible_spend_jpy_max": 100,
        "reward_earned_units_min": "1",
        "reward_earned_units_max": "1",
        "period_start": "2026-08-01T00:00:00+09:00",
        "period_end": "2026-09-01T00:00:00+09:00",
        "observed_at": "2026-08-17T12:00:00+09:00",
        "source": "user_input",
    }
    expect_semantic_failure(
        lambda: validate_user_state(cap_known_unequal, "semantic-self-test/cap-known"),
        "known progress must have equal lower/upper bounds",
        "known cap equality",
    )



def validate_review_contract(review: dict[str, Any], approved: bool, label: str) -> None:
    required = set(review.get("required_review_modes", []))
    events = review.get("review_events", [])
    completed = {event["mode"] for event in events if event.get("decision") == "approved"}
    if not required:
        fail(f"{label}: required_review_modes must not be empty")
    missing = required - completed
    if approved and missing:
        fail(f"{label}: required review modes not completed: {sorted(missing)}")
    primary = review.get("review_mode")
    if primary is not None and approved and primary not in completed:
        fail(f"{label}: primary review_mode has no approved review event")


def validate_conservation_self_test() -> None:
    limited = {
        "lot_id": "lot_limited",
        "quantity": {"asset": {"asset_id": "point.synthetic", "reward_class": "limited_period"}, "amount": "100"},
    }
    result = {
        "asset_movements": [
            {"direction": "consume", "movement_role": "principal_tender", "quantity": {"asset": {"asset_id": "point.synthetic", "reward_class": "limited_period"}, "amount": "100"}},
            {"direction": "create", "movement_role": "principal_output", "quantity": {"asset": {"asset_id": "point.synthetic", "reward_class": "normal"}, "amount": "100"}},
        ],
        "ending_asset_lots": [limited],
    }
    expect_semantic_failure(
        lambda: validate_movement_conservation(result, [limited], "semantic-self-test/reward-class"),
        "asset conservation failed",
        "reward-class conservation",
    )


def validate_rule(rule: dict[str, Any], label: str) -> None:
    valid_from = parse_dt(rule["validity"]["valid_from"], f"{label}/valid_from")
    valid_to = parse_dt(rule["validity"].get("valid_to"), f"{label}/valid_to")
    recorded_at = parse_dt(rule["validity"]["recorded_at"], f"{label}/recorded_at")
    superseded_at = parse_dt(rule["validity"].get("superseded_at"), f"{label}/superseded_at")
    if valid_to is not None and valid_from is not None and valid_to <= valid_from:
        fail(f"{label}: valid_to must be after valid_from")
    if superseded_at is not None and recorded_at is not None and superseded_at <= recorded_at:
        fail(f"{label}: superseded_at must be after recorded_at")

    calculation = rule.get("calculation")
    if calculation is not None:
        model = calculation["model"]
        if model == "points_per_unit" and calculation["rounding"].get("eligible_spend_quantum_jpy") is None:
            fail(f"{label}: points_per_unit requires eligible_spend_quantum_jpy")
        if model == "transfer_ratio":
            minimum = calculation.get("minimum_source_units")
            increment = calculation.get("increment_source_units")
            request_max = calculation.get("maximum_source_units_per_request")
            if minimum is not None and Decimal(minimum) <= 0:
                fail(f"{label}: transfer minimum must be positive")
            if increment is not None and Decimal(increment) <= 0:
                fail(f"{label}: transfer increment must be positive")
            if minimum is not None and request_max is not None and Decimal(request_max) < Decimal(minimum):
                fail(f"{label}: transfer per-request maximum is below minimum")

    for index, cap in enumerate(rule["caps"]):
        if cap["max_reward_units"] is None and cap["max_eligible_spend_jpy"] is None:
            fail(f"{label}/caps/{index}: cap must define a reward or spend maximum")
        reset = cap["reset"]
        if reset["period"] != "never" and not reset["timezone"]:
            fail(f"{label}/caps/{index}: resetting cap requires timezone")

    validate_review_contract(
        rule["audit"],
        rule.get("status") == "published",
        f"{label}/audit",
    )

    output = rule.get("output")
    if output is not None:
        certainty = output["certainty"]
        if certainty["type"] == "probabilistic":
            if certainty.get("probability_source") is None:
                fail(f"{label}: probabilistic reward requires probability_source")
            if certainty.get("probability") is None and certainty.get("probability_source") != "undisclosed":
                fail(f"{label}: disclosed/estimated probability source requires probability")


def validate_movement_conservation(
    result: dict[str, Any],
    opening_lots: list[dict[str, Any]],
    label: str,
) -> None:
    """Check principal asset conservation for exact package fixtures.

    External funding is an economic source rather than a reusable opening lot and is
    excluded. Reward components are validated separately. Conservation buckets are
    keyed by both asset_id and reward_class; limited and normal points are not fungible.
    The v0.4.1 contract has no generic `adjust` direction.
    """

    def bucket(quantity: dict[str, Any]) -> tuple[str, str | None]:
        asset = quantity["asset"]
        return asset["asset_id"], asset.get("reward_class")

    opening_by_asset: defaultdict[tuple[str, str | None], Decimal] = defaultdict(Decimal)
    for lot in opening_lots:
        opening_by_asset[bucket(lot["quantity"])] += Decimal(lot["quantity"]["amount"])

    movement_net: defaultdict[tuple[str, str | None], Decimal] = defaultdict(Decimal)
    affected_assets: set[tuple[str, str | None]] = set()
    for movement in result["asset_movements"]:
        if movement["movement_role"] in {"external_funding", "fee"}:
            continue
        if movement["direction"] == "adjust":
            fail(f"{label}: generic adjust movements are forbidden in v0.4.1")
        key = bucket(movement["quantity"])
        amount = Decimal(movement["quantity"]["amount"])
        affected_assets.add(key)
        if movement["direction"] in {"create", "return"}:
            movement_net[key] += amount
        elif movement["direction"] in {"consume", "expire"}:
            movement_net[key] -= amount
        else:
            fail(f"{label}: unsupported movement direction {movement['direction']}")

    ending_by_asset: defaultdict[tuple[str, str | None], Decimal] = defaultdict(Decimal)
    for lot in result["ending_asset_lots"]:
        key = bucket(lot["quantity"])
        ending_by_asset[key] += Decimal(lot["quantity"]["amount"])
        affected_assets.add(key)

    for key in affected_assets:
        expected = opening_by_asset[key] + movement_net[key]
        actual = ending_by_asset[key]
        if expected != actual:
            asset_id, reward_class = key
            fail(
                f"{label}: asset conservation failed for {asset_id}/{reward_class}: "
                f"expected ending {expected}, found {actual}"
            )


def validate_golden_scenario(scenario: dict[str, Any], label: str) -> None:
    validate_user_state(scenario["user_state"], f"{label}/user_state")
    validate_review_contract(
        scenario["review"],
        scenario["review"].get("decision") == "approved",
        f"{label}/review",
    )
    opening_lots = scenario["user_state"]["asset_lots"]
    opening_lot_ids = {lot["lot_id"] for lot in opening_lots}

    plans = scenario["candidate_plans"]
    plan_ids = [plan["plan_id"] for plan in plans]
    duplicates = duplicate_values(plan_ids)
    if duplicates:
        fail(f"{label}: duplicate plan IDs {duplicates}")
    for index, plan in enumerate(plans):
        validate_plan(plan, f"{label}/candidate_plans/{index}", opening_lot_ids)

    signatures = [purchase_signature(plan) for plan in plans]
    if all(signatures) and len({json.dumps(signature, sort_keys=True) for signature in signatures}) != 1:
        fail(f"{label}: candidate plans do not complete the same frozen purchase")

    expected = scenario["expected"]
    result_ids = [result["plan_id"] for result in expected["plan_results"]]
    if set(result_ids) != set(plan_ids) or len(result_ids) != len(plan_ids):
        fail(f"{label}: plan results must contain every candidate plan exactly once")
    mode = expected["outcome_mode"]
    winner = expected["definite_winner_plan_id"]
    safe = expected["safe_plan_id"]
    conditional = expected["conditional_winners"]
    if mode == "definite":
        if winner not in plan_ids or safe not in plan_ids or conditional:
            fail(f"{label}: definite outcome requires winner, safe plan, and no conditional winners")
    elif mode == "conditional":
        if winner is not None or not conditional:
            fail(f"{label}: conditional outcome requires conditional winners and no definite winner")
        unknown = [row["plan_id"] for row in conditional if row["plan_id"] not in plan_ids]
        if unknown:
            fail(f"{label}: unknown conditional winner plan IDs {unknown}")
        if safe is not None and safe not in plan_ids:
            fail(f"{label}: safe plan references unknown plan")
    elif mode == "no_valid_plan" and any(value is not None for value in (winner, safe, expected["runner_up_plan_id"])):
        fail(f"{label}: no_valid_plan cannot name winner, safe plan, or runner-up")
    runner = expected["runner_up_plan_id"]
    if runner is not None and runner not in plan_ids:
        fail(f"{label}: runner-up references unknown plan")
    if runner is not None and runner == winner:
        fail(f"{label}: runner-up cannot equal winner")

    plan_by_id = {plan["plan_id"]: plan for plan in plans}
    exact_scores: dict[str, int] = {}
    for result_index, result in enumerate(expected["plan_results"]):
        result_label = f"{label}/expected/plan_results/{result_index}"
        plan = plan_by_id[result["plan_id"]]
        operation_ids = {operation["operation_id"] for operation in plan["operations"]}

        movement_ids = [movement["movement_id"] for movement in result["asset_movements"]]
        if duplicate_values(movement_ids):
            fail(f"{result_label}: duplicate movement IDs")
        for movement_index, movement in enumerate(result["asset_movements"]):
            if movement["operation_id"] not in operation_ids:
                fail(f"{result_label}/asset_movements/{movement_index}: movement references operation outside its plan")
            if Decimal(movement["quantity"]["amount"]) < 0:
                fail(f"{result_label}/asset_movements/{movement_index}: negative movement quantity")

        component_ids = [component["component_id"] for component in result["reward_components"]]
        if duplicate_values(component_ids):
            fail(f"{result_label}: duplicate reward component IDs")
        for component_index, component in enumerate(result["reward_components"]):
            if component["operation_id"] not in operation_ids:
                fail(f"{result_label}/reward_components/{component_index}: component references operation outside its plan")
            validate_value_range(component["value_jpy"], f"{result_label}/reward_components/{component_index}/value_jpy")

        ending_ids = [lot["lot_id"] for lot in result["ending_asset_lots"]]
        if duplicate_values(ending_ids):
            fail(f"{result_label}: duplicate ending asset-lot IDs")
        for lot_index, lot in enumerate(result["ending_asset_lots"]):
            validate_asset_lot(lot, f"{result_label}/ending_asset_lots/{lot_index}")
        validate_movement_conservation(result, opening_lots, result_label)

        economics = result["economics"]
        for field, value in economics.items():
            validate_value_range(value, f"{result_label}/economics/{field}")
        validate_value_range(result["objective_score_jpy"], f"{result_label}/objective_score_jpy")
        if result["nominal_return_basis_points"] is not None:
            nr = result["nominal_return_basis_points"]
            if nr["minimum"] > nr["maximum"]:
                fail(f"{result_label}: nominal return minimum exceeds maximum")
            if nr["expected"] is not None and not nr["minimum"] <= nr["expected"] <= nr["maximum"]:
                fail(f"{result_label}: nominal return expected is outside range")

        exact_economics = {key: exact_value(value) for key, value in economics.items()}
        if all(value is not None for value in exact_economics.values()):
            guaranteed = (
                exact_economics["merchant_value_received_jpy"]
                + exact_economics["ending_asset_value_jpy"]
                + exact_economics["guaranteed_reward_value_jpy"]
                - exact_economics["external_funding_jpy"]
                - exact_economics["opening_asset_value_consumed_jpy"]
                - exact_economics["fee_value_jpy"]
            )
            expected_net = guaranteed + exact_economics["probabilistic_expected_reward_value_jpy"]
            if exact_economics["guaranteed_net_value_change_jpy"] != guaranteed:
                fail(f"{result_label}: guaranteed economics do not reconcile")
            if exact_economics["expected_net_value_change_jpy"] != expected_net:
                fail(f"{result_label}: expected economics do not reconcile")

            guaranteed_component_value = 0
            probabilistic_component_value = 0
            for component in result["reward_components"]:
                component_value = exact_value(component["value_jpy"])
                if component_value is None:
                    break
                signed_value = component_value if component["sign"] == "credit" else -component_value
                if component["certainty"]["type"] == "guaranteed":
                    guaranteed_component_value += signed_value
                elif component["certainty"]["type"] == "probabilistic":
                    probabilistic_component_value += signed_value
            else:
                if guaranteed_component_value != exact_economics["guaranteed_reward_value_jpy"]:
                    fail(f"{result_label}: guaranteed reward components do not reconcile to economics")
                if probabilistic_component_value != exact_economics["probabilistic_expected_reward_value_jpy"]:
                    fail(f"{result_label}: probabilistic reward components do not reconcile to economics")

        score = exact_value(result["objective_score_jpy"])
        if score is not None:
            exact_scores[result["plan_id"]] = score
            primary = scenario["objective"]["primary"]
            if primary == "maximize_guaranteed_net_value":
                guaranteed_score = exact_value(economics["guaranteed_net_value_change_jpy"])
                if guaranteed_score is not None and score != guaranteed_score:
                    fail(f"{result_label}: objective score does not equal guaranteed net value")
            elif primary == "maximize_expected_net_value":
                expected_score = exact_value(economics["expected_net_value_change_jpy"])
                if expected_score is not None and score != expected_score:
                    fail(f"{result_label}: objective score does not equal expected net value")

    if mode == "definite" and len(exact_scores) == len(plans):
        best_score = max(exact_scores.values())
        best = [plan_id for plan_id, score in exact_scores.items() if score == best_score]
        if winner not in best:
            fail(f"{label}: definite winner does not have the highest exact objective score")

    review = scenario["review"]
    if review["decision"] == "approved":
        if review["review_mode"] == "solo_dual_pass":
            if review["cooling_off_completed_at"] is None or review["independent_calculation_artifact"] is None:
                fail(f"{label}: approved solo dual-pass review requires cooling-off and calculation artifact")
        if review["verified_at"] is None:
            fail(f"{label}: approved fixture requires verified_at")



def _ending_asset_quantity(result: dict[str, Any], asset_id: str, reward_class: str | None) -> Decimal:
    total = Decimal(0)
    for lot in result["ending_asset_lots"]:
        ref = lot["quantity"]["asset"]
        if ref["asset_id"] == asset_id and ref.get("reward_class") == reward_class:
            total += Decimal(lot["quantity"]["amount"])
    return total


def _valuation_entry(scenario: dict[str, Any], asset_id: str, reward_class: str | None) -> dict[str, Any]:
    matches = [
        row for row in scenario["user_state"]["valuation_profile"]["entries"]
        if row["asset_id"] == asset_id and row.get("reward_class") == reward_class
    ]
    if len(matches) != 1:
        fail(
            f"{scenario['scenario_id']}: expected exactly one valuation entry for "
            f"{asset_id}/{reward_class}, found {len(matches)}"
        )
    return matches[0]


def validate_valuation_sensitivities(scenario: dict[str, Any], label: str) -> None:
    """Validate one-variable break-even claims without mutating native accounting.

    For each declared sensitivity, all other valuation assumptions remain fixed. The
    exact net-value result at the current valuation is decomposed into a constant
    term plus ending quantity of the named asset times its JPY-per-unit valuation.
    """

    results = {row["plan_id"]: row for row in scenario["expected"]["plan_results"]}
    declared_winner = scenario["expected"]["definite_winner_plan_id"]
    sensitivities = scenario["expected"].get("valuation_sensitivities", [])
    if not sensitivities:
        fail(f"{label}: at least one valuation sensitivity is required")

    for index, sensitivity in enumerate(sensitivities):
        item_label = f"{label}/expected/valuation_sensitivities/{index}"
        asset_id = sensitivity["asset_id"]
        reward_class = sensitivity.get("reward_class")
        low_id = sensitivity["winner_at_or_below_threshold_plan_id"]
        high_id = sensitivity["winner_above_threshold_plan_id"]
        if low_id not in results or high_id not in results or low_id == high_id:
            fail(f"{item_label}: sensitivity must reference two distinct candidate plans")

        valuation = _valuation_entry(scenario, asset_id, reward_class)
        current = Decimal(valuation["jpy_per_unit"])
        if current != Decimal(sensitivity["current_jpy_per_unit"]):
            fail(f"{item_label}: current value does not match the valuation profile")

        low_result = results[low_id]
        high_result = results[high_id]
        low_net = exact_value(low_result["economics"]["guaranteed_net_value_change_jpy"])
        high_net = exact_value(high_result["economics"]["guaranteed_net_value_change_jpy"])
        if low_net is None or high_net is None:
            fail(f"{item_label}: package sensitivity fixtures require exact guaranteed economics")

        low_quantity = _ending_asset_quantity(low_result, asset_id, reward_class)
        high_quantity = _ending_asset_quantity(high_result, asset_id, reward_class)
        quantity_delta = high_quantity - low_quantity
        if quantity_delta == 0:
            fail(f"{item_label}: referenced plans have no quantity difference for the sensitive asset")

        low_constant = Decimal(low_net) - low_quantity * current
        high_constant = Decimal(high_net) - high_quantity * current
        computed = (low_constant - high_constant) / quantity_delta
        declared = Decimal(sensitivity["break_even_jpy_per_unit"])
        if abs(computed - declared) > Decimal("1e-18"):
            fail(f"{item_label}: declared break-even {declared} does not match computed {computed}")

        expected_winner = low_id if current <= declared else high_id
        if declared_winner != expected_winner:
            fail(
                f"{item_label}: current valuation implies winner {expected_winner}, "
                f"but fixture declares {declared_winner}"
            )

def assert_schema_contract_features(schemas: dict[str, dict[str, Any]]) -> None:
    rule = schemas["reward-rule.schema.json"]
    scope = rule["$defs"]["scope"]["properties"]
    for key in (
        "operation_types",
        "excluded_merchant_ids",
        "excluded_merchant_group_ids",
        "excluded_merchant_location_ids",
    ):
        if key not in scope:
            fail(f"reward-rule schema is missing {key}")
    cap = rule["$defs"]["cap"]["properties"]
    for key in ("reset", "partial_consumption", "unknown_progress_policy"):
        if key not in cap:
            fail(f"reward-rule cap schema is missing {key}")
    transfer = rule["$defs"]["transferCalculation"]["properties"]
    for key in (
        "minimum_source_units",
        "increment_source_units",
        "maximum_source_units_per_request",
        "maximum_source_units_per_period",
        "cancellation_policy",
    ):
        if key not in transfer:
            fail(f"transfer schema is missing {key}")
    if "effect" not in rule["properties"]:
        fail("non-financial effect is missing from reward-rule schema")

    plan = schemas["purchase-plan.schema.json"]
    for key in ("operations", "dependencies", "loyalty_presentments"):
        if key not in plan["properties"]:
            fail(f"purchase-plan schema is missing {key}")
    operation = plan["$defs"]["operation"]["properties"]
    for key in ("operation_type", "occurred_at", "asset_inputs", "output_requests", "original_operation_id"):
        if key not in operation:
            fail(f"purchase-plan operation is missing {key}")

    asset = schemas["asset.schema.json"]
    for key in ("assetMovement", "assetLot", "rewardComponent", "jpyValueRange"):
        if key not in asset["$defs"]:
            fail(f"asset schema is missing {key}")
    restrictions = asset["$defs"]["usageRestrictions"]["properties"]
    if "investable" not in restrictions:
        fail("asset usage restrictions are missing investable")
    movement_directions = asset["$defs"]["assetMovement"]["properties"]["direction"]["enum"]
    if "adjust" in movement_directions:
        fail("generic adjust movement remains in the v0.4.1 contract")

    user = schemas["user-state.schema.json"]
    statuses = user["$defs"]["stateValue"]["properties"]["status"]["enum"]
    if set(statuses) != {"known", "estimated", "unknown", "not_applicable"}:
        fail("user-state status enum is incomplete")
    if "comparableBound" not in user["$defs"]:
        fail("user-state schema is missing comparableBound")

    certainty = asset["$defs"]["certainty"]
    probabilistic_then = certainty["allOf"][0]["then"]["properties"]["probability_source"]
    if "null" in (probabilistic_then.get("type") if isinstance(probabilistic_then.get("type"), list) else []):
        fail("probabilistic probability_source may not remain null")

    golden = schemas["golden-scenario.schema.json"]
    for key in ("objective", "candidate_plans", "expected"):
        if key not in golden["properties"]:
            fail(f"golden-scenario schema is missing {key}")
    expected = golden["$defs"]["expected"]["properties"]
    for key in ("safe_plan_id", "conditional_winners", "questions_to_resolve", "valuation_sensitivities"):
        if key not in expected:
            fail(f"golden-scenario output is missing {key}")
    review_properties = golden["$defs"]["review"]["properties"]
    for key in ("required_review_modes", "review_events"):
        if key not in review_properties:
            fail(f"golden-scenario review contract is missing {key}")

    economics = golden["$defs"]["economics"]["properties"]
    for key in (
        "merchant_value_received_jpy",
        "external_funding_jpy",
        "opening_asset_value_consumed_jpy",
        "ending_asset_value_jpy",
        "guaranteed_reward_value_jpy",
        "probabilistic_expected_reward_value_jpy",
        "fee_value_jpy",
        "guaranteed_net_value_change_jpy",
        "expected_net_value_change_jpy",
    ):
        if key not in economics:
            fail(f"golden-scenario economics is missing {key}")


def validate_sql_structure() -> None:
    sql_path = BASE / "db/0001_core_schema.sql"
    sql = sql_path.read_text(encoding="utf-8").lower()
    required_markers = (
        "create schema if not exists app_private",
        "create schema if not exists app_api",
        "create schema if not exists user_data",
        "alter default privileges",
        "enable row level security",
        "force row level security",
        "create extension if not exists btree_gist",
        "reward_rule_versions_no_bitemporal_overlap",
        "tstzrange(recorded_at, coalesce(superseded_at",
        "security_invoker = true",
        "security_barrier = true",
        "exclude using gist",
        "source_access_observations",
        "extraction_candidate_snapshots",
        "protect_reward_rule_version",
        "source_snapshots_immutable",
        "canonical_replay_runs",
        "user_recommendation_history",
        "retention_class",
        "purge_after",
        "references user_data.user_profiles(user_id) on delete cascade",
        "reward_class text check",
        "expected_posting_from",
        "expiry_policy",
        "rule_publication_requests",
        "required_review_modes",
        "completed_review_modes",
        "reward_rule_versions_definition_hash_idx",
    )
    missing = [marker for marker in required_markers if marker not in sql]
    if missing:
        fail(f"SQL reference is missing structural markers: {missing}")
    if "reward_rule_versions_no_approved_overlap" in sql:
        fail("SQL still contains the current-only approved-overlap constraint")
    if "unique (rule_id, definition_hash)" in sql:
        fail("definition_hash is still incorrectly unique across rule history")
    if "source_snapshot_ids uuid[]" in sql:
        fail("SQL still uses an unenforced source_snapshot_ids UUID array")
    if re.search(r"\bcurrent_version\b", sql):
        fail("SQL still contains denormalized reward_rules.current_version")
    if sql.count("references user_data.user_profiles(user_id) on delete cascade") < 7:
        fail("SQL does not cascade all user-owned roots through user_profiles")
    if sql.count("begin;") != 1 or not sql.rstrip().endswith("commit;"):
        fail("SQL baseline must contain one transaction ending in COMMIT")


    replay_test = (BASE / "db/tests/001_bitemporal_replay.sql").read_text(encoding="utf-8").lower()
    for marker in (
        "expected bitemporal exclusion violation",
        "ambiguous replay for tx",
        "2026-04-01t00:00:00z",
        "rollback;",
    ):
        if marker not in replay_test:
            fail(f"bitemporal replay integration test is missing marker: {marker}")

    view_test = (BASE / "db/tests/002_view_security.sql").read_text(encoding="utf-8").lower()
    for marker in (
        "security-invoker view unexpectedly lent underlying privileges",
        "grant usage on schema app_private",
        "grant select on app_private.trusted_sources",
        "drop role jro_view_test",
    ):
        if marker not in view_test:
            fail(f"view-security integration test is missing marker: {marker}")

    consumer_sql = (BASE / "db/0002_agent_feed_consumer.sql").read_text(encoding="utf-8").lower()
    for marker in (
        "monitor_stream_expectations",
        "sweep_overdue_monitor_streams",
        "source_monitoring_freshness",
        "enforce_source_observation_transition",
        "redact_expired_agent_feed_receipts",
        "redaction_status = 'complete'",
    ):
        if marker not in consumer_sql:
            fail(f"Agent Feed consumer SQL is missing v0.4.1 marker: {marker}")

    hardening_test = (BASE / "db/tests/004_v0_4_1_hardening.sql").read_text(encoding="utf-8").lower()
    for marker in (
        "same canonical economic definition",
        "expected required review constraint violation",
        "expected publication idempotency conflict",
    ):
        if marker not in hardening_test:
            fail(f"v0.4.1 hardening SQL test is missing marker: {marker}")


def validate_docs_and_scripts() -> None:
    forbidden_refs = (
        "registry/trusted-sources.v0.1.yaml",
        "scenarios/scenario-coverage-plan.v0.1.yaml",
    )
    canonical_paths = [
        BASE / "README.md",
        BASE / "docs/01_trust_and_provenance_policy.md",
        BASE / "docs/03_reward_rule_specification.md",
        BASE / "docs/04_implementation_plan.md",
        BASE / "docs/05_ingestion_and_review_workflow.md",
        BASE / "docs/06_golden_scenario_program.md",
        BASE / "docs/08_architecture_decisions.md",
        BASE / "docs/09_codex_execution_contract.md",
        BASE / "docs/11_review_decisions_v0.3.md",
        BASE / "docs/13_semantic_validation_contract.md",
        BASE / "docs/14_residual_valuation_and_sensitivity.md",
        BASE / "docs/19_review_decisions_v0.4.1.md",
        BASE / "docs/00_product_requirements.md",
        BASE / "prototype/README.md",
        BASE / "docs/15_agent_feed_integration.md",
        BASE / "docs/16_supabase_stack_decision.md",
        BASE / "docs/17_monitoring_producer_contract.md",
        BASE / "docs/18_v0.4_agent_feed_decisions.md",
        BASE / "db/tests/001_bitemporal_replay.sql",
        BASE / "db/tests/002_view_security.sql",
        BASE / "db/0002_agent_feed_consumer.sql",
        BASE / "db/tests/003_agent_feed_consumer.sql",
        BASE / "prompts/CODEX_INITIATING_PROMPT.md",
        BASE / "prompts/CODEX_MILESTONE_1B_PROMPT.md",
        BASE / "prompts/CODEX_AGENT_FEED_INTEGRATION_PROMPT.md",
        BASE / "prompts/SOURCE_MAINTENANCE_REHEARSAL_PROMPT.md",
    ]
    for path in canonical_paths:
        text = path.read_text(encoding="utf-8")
        for forbidden in forbidden_refs:
            if forbidden in text:
                fail(f"{path.relative_to(BASE)} contains stale canonical reference {forbidden}")
    checksum_script = (BASE / "scripts/generate_checksums.py").read_text(encoding="utf-8")
    for flag in ("--write", "--check"):
        if flag not in checksum_script:
            fail(f"checksum script is missing {flag}")
    prompt = (BASE / "prompts/CODEX_INITIATING_PROMPT.md").read_text(encoding="utf-8")
    if "new contract-affecting contradiction" not in prompt:
        fail("Codex prompt does not contain the new-contradiction stop rule")
    if "purchase-plan.schema.json" not in prompt:
        fail("Codex prompt does not require the v0.4 purchase-plan contract")
    for marker in (
        "Milestone 1a",
        "percentage",
        "points-per-unit",
        "Do not implement fixed",
        "db/tests/001_bitemporal_replay.sql",
        "db/tests/002_view_security.sql",
    ):
        if marker not in prompt:
            fail(f"Codex initiating prompt is missing its narrowed 1A boundary: {marker}")
    rehearsal_prompt = (BASE / "prompts/SOURCE_MAINTENANCE_REHEARSAL_PROMPT.md").read_text(encoding="utf-8")
    for marker in ("Never publish a rule automatically", "Never infer collection permission", "eight-source"):
        if marker not in rehearsal_prompt:
            fail(f"Source-maintenance prompt is missing required marker: {marker}")


def main() -> int:
    validate_all_serialized_files()

    schema_paths = sorted(SCHEMA_DIR.glob("*.json"))
    schema_files = {path.name for path in schema_paths}
    if schema_files != EXPECTED_SCHEMA_FILES:
        fail(
            "Unexpected schema file set. "
            f"Missing={sorted(EXPECTED_SCHEMA_FILES - schema_files)}, "
            f"extra={sorted(schema_files - EXPECTED_SCHEMA_FILES)}"
        )
    schemas = {path.name: load_json(path) for path in schema_paths}
    schema_registry = build_schema_registry(schemas)
    assert_schema_contract_features(schemas)

    manifest = load_json(BASE / "package-manifest.json")
    if manifest["version"] != "0.4.1":
        fail("Package manifest version must be 0.4.1")
    if manifest["counts"]["json_schemas"] != len(schemas):
        fail("Package manifest schema count does not match")
    for path in manifest["canonical_files"].values():
        if not (BASE / path).is_file():
            fail(f"Manifest canonical file does not exist: {path}")

    registry_yaml = load_yaml(BASE / "registry/trusted-sources.v0.3.yaml")
    registry_json = load_json(BASE / "registry/trusted-sources.v0.3.json")
    if registry_yaml != registry_json:
        fail("YAML and JSON trusted-source registries are not semantically identical")
    validate_schema(
        registry_yaml,
        schemas["trusted-source-registry.schema.json"],
        schema_registry,
        "source-registry",
    )
    sources = registry_yaml["sources"]
    if len(sources) != EXPECTED_SOURCE_COUNT:
        fail(f"Expected {EXPECTED_SOURCE_COUNT} source seeds, found {len(sources)}")
    if manifest["counts"]["trusted_sources"] != len(sources):
        fail("Manifest trusted-source count does not match")
    source_ids = [source["id"] for source in sources]
    if duplicate_values(source_ids):
        fail(f"Duplicate source IDs: {duplicate_values(source_ids)}")
    source_urls = [source["source_url"] for source in sources]
    if duplicate_values(source_urls):
        fail(f"Duplicate source URLs: {duplicate_values(source_urls)}")
    for url in source_urls:
        parsed = urlparse(url)
        if parsed.scheme not in {"https", "http"} or not parsed.netloc:
            fail(f"Invalid source URL: {url}")
    source_set = set(source_ids)

    observation_wrapper = load_yaml(BASE / "registry/source-access-observations.v0.3.yaml")
    observations = observation_wrapper["observations"]
    if manifest["counts"]["source_access_observations"] != len(observations):
        fail("Manifest source-access observation count does not match")
    observation_ids = [observation["observation_id"] for observation in observations]
    if duplicate_values(observation_ids):
        fail("Duplicate source-access observation IDs")
    observation_by_id = {observation["observation_id"]: observation for observation in observations}
    for index, observation in enumerate(observations):
        validate_schema(
            observation,
            schemas["source-access-observation.schema.json"],
            schema_registry,
            f"source-access-observation[{index}]",
        )
        unknown_sources = set(observation["source_ids"]) - source_set
        if unknown_sources:
            fail(f"Observation {observation['observation_id']} references unknown sources {sorted(unknown_sources)}")
        if observation["result"] == "aggregate" and observation["summary_counts"]:
            if sum(observation["summary_counts"].values()) != len(observation["source_ids"]):
                fail(f"Aggregate observation {observation['observation_id']} count does not match source_ids")
    for source in sources:
        verification = source["verification"]
        if verification["status"] == "content_verified" and verification["content_verified_on"] is None:
            fail(f"Content-verified source {source['id']} lacks content_verified_on")
        technical = source["access"]["technical_feasibility"]
        for observation_id in technical["observation_ids"]:
            if observation_id not in observation_by_id:
                fail(f"Source {source['id']} references unknown observation {observation_id}")
            observation = observation_by_id[observation_id]
            if observation["source_ids"] and source["id"] not in observation["source_ids"]:
                fail(f"Source {source['id']} is not in referenced observation {observation_id}")
        if technical["current_classification"] != "unknown" and not technical["observation_ids"]:
            fail(f"Source {source['id']} has technical classification without an observation")
        if technical["observation_ids"] and technical["last_observed_at"] is None:
            fail(f"Source {source['id']} references observations but has no last_observed_at")


    viewcard = next(source for source in sources if source["id"] == "jp.viewcard.suica-charge")
    view_tech = viewcard["access"]["technical_feasibility"]
    if view_tech["current_classification"] != "environment_dependent_or_mixed":
        fail("View Card source must preserve mixed environment reachability")
    if set(view_tech["observation_ids"]) != {
        "sao_official_web_checks_20260817",
        "sao_independent_review_viewcard_20260817",
    }:
        fail("View Card source does not retain both reachability observations")

    monitored_urls = (BASE / "registry/monitored-url-seeds.txt").read_text(encoding="utf-8").splitlines()
    if monitored_urls != source_urls:
        fail("monitored-url-seeds.txt must match registry URLs in canonical order")

    review_queue = load_yaml(BASE / "registry/source-review-queue.v0.3.yaml")
    queue_ids = [item["source_id"] for item in review_queue["items"]]
    if len(queue_ids) != len(sources) or set(queue_ids) != source_set or duplicate_values(queue_ids):
        fail("Source review queue must contain every registry source exactly once")
    rehearsal_ids = [item["source_id"] for item in review_queue["first_rehearsal_batch"]]
    if len(rehearsal_ids) != 8 or len(set(rehearsal_ids)) != 8:
        fail("First source-maintenance rehearsal batch must contain eight unique sources")
    if not set(rehearsal_ids) <= source_set:
        fail("First rehearsal batch references an unknown source")
    pilot = load_yaml(BASE / "registry/source-maintenance-pilot.v0.3.yaml")
    pilot_ids = [item["source_id"] for item in pilot["sources"]]
    if pilot_ids != rehearsal_ids:
        fail("Source-maintenance pilot must use the exact first rehearsal batch order")

    example_contracts = {
        "asset.example.yaml": "asset.schema.json",
        "source.example.yaml": "trusted-source.schema.json",
        "source-access-observation.example.yaml": "source-access-observation.schema.json",
        "evidence.example.yaml": "evidence-record.schema.json",
        "extraction-candidate.example.yaml": "extraction-candidate.schema.json",
        "extraction-candidate.prompt-injection.expected.yaml": "extraction-candidate.schema.json",
        "purchase-plan.example.yaml": "purchase-plan.schema.json",
        "reward-rule.example.yaml": "reward-rule.schema.json",
        "golden-scenario.example.yaml": "golden-scenario.schema.json",
        "golden-scenario.valuation-flip.example.yaml": "golden-scenario.schema.json",
        "source-observation.from-agent-feed.example.yaml": "source-observation.schema.json",
        "source-observation.prompt-injection.expected.yaml": "source-observation.schema.json",
    }
    loaded_examples: dict[str, Any] = {}
    for filename, schema_name in example_contracts.items():
        instance = load_yaml(BASE / "examples" / filename)
        loaded_examples[filename] = instance
        validate_schema(instance, schemas[schema_name], schema_registry, filename)
    validate_schema(
        load_yaml(BASE / "registry/source-onboarding-template.yaml"),
        schemas["trusted-source.schema.json"],
        schema_registry,
        "source-onboarding-template",
    )
    validate_schema(
        load_yaml(BASE / "registry/source-access-observation-template.yaml"),
        schemas["source-access-observation.schema.json"],
        schema_registry,
        "source-access-observation-template",
    )

    source_example = loaded_examples["source.example.yaml"]
    registry_source = next((source for source in sources if source["id"] == source_example["id"]), None)
    if source_example != registry_source:
        fail("source.example.yaml must exactly match its canonical registry entry")

    candidate = loaded_examples["extraction-candidate.example.yaml"]
    for index, rule in enumerate(candidate["candidate_rules"]):
        validate_schema(rule, schemas["reward-rule.schema.json"], schema_registry, f"extraction-candidate.example.yaml/candidate_rules/{index}")
        validate_rule(rule, f"extraction-candidate.example.yaml/candidate_rules/{index}")

    purchase_plan = loaded_examples["purchase-plan.example.yaml"]
    validate_plan(purchase_plan, "purchase-plan.example.yaml")
    reward_rule = loaded_examples["reward-rule.example.yaml"]
    validate_rule(reward_rule, "reward-rule.example.yaml")
    golden = loaded_examples["golden-scenario.example.yaml"]
    golden_flip = loaded_examples["golden-scenario.valuation-flip.example.yaml"]
    validate_golden_scenario(golden, "golden-scenario.example.yaml")
    validate_golden_scenario(golden_flip, "golden-scenario.valuation-flip.example.yaml")
    validate_valuation_sensitivities(golden, "golden-scenario.example.yaml")
    validate_valuation_sensitivities(golden_flip, "golden-scenario.valuation-flip.example.yaml")
    validate_semantic_self_tests(golden["user_state"])
    validate_conservation_self_test()

    source_observation = loaded_examples["source-observation.from-agent-feed.example.yaml"]
    if source_observation["agent_feed"]["protocol_version"] != "0.1":
        fail("SourceObservation must pin Agent Feed protocol 0.1")
    if source_observation["canonical_evidence_ids"]:
        fail("Synthetic Agent Feed observation must not start with canonical evidence")
    if source_observation["status"] not in {"needs_evidence", "needs_review"}:
        fail("Agent Feed observation must remain untrusted pending evidence/review")

    hostile_observation = loaded_examples["source-observation.prompt-injection.expected.yaml"]
    if hostile_observation["status"] != "rejected":
        fail("Hostile Agent Feed observation must be rejected")
    if hostile_observation["canonical_evidence_ids"]:
        fail("Hostile Agent Feed observation must not create canonical evidence")
    if not {"embedded_instruction", "attempted_authority_escalation"} <= set(hostile_observation["security_flags"]):
        fail("Hostile Agent Feed observation lacks required security flags")

    native_fields = (
        "eligible", "asset_movements", "reward_components", "ending_asset_lots",
        "applied_rule_ids", "rejected_rule_ids", "rejection_reasons",
    )
    native_one = {row["plan_id"]: {key: row[key] for key in native_fields} for row in golden["expected"]["plan_results"]}
    native_two = {row["plan_id"]: {key: row[key] for key in native_fields} for row in golden_flip["expected"]["plan_results"]}
    if native_one != native_two:
        fail("Valuation-flip fixtures do not preserve identical native plan results")
    if golden["expected"]["definite_winner_plan_id"] == golden_flip["expected"]["definite_winner_plan_id"]:
        fail("Valuation-flip fixtures do not reverse the winner")

    evidence = loaded_examples["evidence.example.yaml"]
    validate_review_contract(
        evidence["review"],
        evidence.get("status") == "verified",
        "evidence.example.yaml/review",
    )
    if evidence["evidence_id"] not in reward_rule["provenance"]["evidence_ids"]:
        fail("Synthetic rule does not cite the synthetic evidence record")
    if evidence["evidence_id"] not in golden["evidence_ids"]:
        fail("Synthetic golden scenario does not cite the synthetic evidence record")
    if evidence["evidence_id"] not in golden_flip["evidence_ids"]:
        fail("Valuation-flip scenario does not cite the synthetic evidence record")

    hostile_snapshot = (BASE / "examples/source-snapshot.prompt-injection.fixture.html").read_text(encoding="utf-8")
    expected_injection = loaded_examples["extraction-candidate.prompt-injection.expected.yaml"]
    if "ignore previous" not in hostile_snapshot.lower() and "set the reward rate" not in hostile_snapshot.lower():
        fail("Prompt-injection source fixture lacks a hostile embedded instruction")
    if expected_injection["candidate_rules"]:
        fail("Prompt-injection expected output must contain no candidate rules")
    if not any(flag["flag_type"] == "embedded_instruction" for flag in expected_injection["security_flags"]):
        fail("Prompt-injection expected output lacks embedded_instruction flag")

    seeds = load_yaml(BASE / "examples/ten-seed-scenario-blueprints.yaml")
    if len(seeds["scenarios"]) != 10:
        fail(f"Expected ten seed blueprints, found {len(seeds['scenarios'])}")
    if manifest["counts"]["seed_scenario_blueprints"] != len(seeds["scenarios"]):
        fail("Manifest seed-scenario count does not match")
    seed_ids = [scenario["scenario_id"] for scenario in seeds["scenarios"]]
    if duplicate_values(seed_ids):
        fail("Duplicate seed scenario IDs")
    for scenario in seeds["scenarios"]:
        if scenario.get("expected_result_status") != "to_be_researched":
            fail(f"Seed {scenario['scenario_id']} must remain to_be_researched")
        for source_id in scenario["primary_source_ids"]:
            if source_id not in source_set:
                fail(f"Unknown source {source_id} in seed {scenario['scenario_id']}")

    scenario_plan = load_yaml(BASE / "scenarios/scenario-coverage-plan.v0.3.yaml")
    scenarios = scenario_plan["scenarios"]
    if len(scenarios) != EXPECTED_SCENARIO_COUNT:
        fail(f"Expected {EXPECTED_SCENARIO_COUNT} planned scenarios, found {len(scenarios)}")
    if manifest["counts"]["planned_scenarios"] != len(scenarios):
        fail("Manifest planned-scenario count does not match")
    scenario_ids = [scenario["scenario_id"] for scenario in scenarios]
    if duplicate_values(scenario_ids):
        fail("Duplicate planned scenario IDs")
    level_counts = Counter(scenario["level"] for scenario in scenarios)
    if level_counts != EXPECTED_LEVELS:
        fail(f"Unexpected level split {dict(level_counts)}; expected {dict(EXPECTED_LEVELS)}")
    category_counts = Counter(scenario["category"] for scenario in scenarios)
    declared_categories = Counter(scenario_plan["distribution"]["by_category"])
    if category_counts != declared_categories:
        fail(f"Scenario category counts do not match declared distribution: {dict(category_counts)}")
    if set(seed_ids) - set(scenario_ids):
        fail(f"Seed blueprints reference scenarios missing from the 100-plan: {sorted(set(seed_ids)-set(scenario_ids))}")
    for scenario in scenarios:
        if scenario["status"] == "golden":
            fail(f"Planned scenario {scenario['scenario_id']} cannot already be golden")
        for source_id in scenario.get("primary_source_ids", []):
            if source_id not in source_set:
                fail(f"Unknown source {source_id} in scenario {scenario['scenario_id']}")
        if not scenario.get("required_negative_assertion"):
            fail(f"Scenario {scenario['scenario_id']} lacks a required negative assertion")

    validate_sql_structure()

    agent_feed_sql = (BASE / "db/0002_agent_feed_consumer.sql").read_text(encoding="utf-8").lower()
    for marker in (
        "agent_feed_receipts",
        "source_observations",
        "source_observation_submitted_evidence",
        "protocol_version = '0.1'",
        "never a published rule",
    ):
        if marker not in agent_feed_sql:
            fail(f"Agent Feed consumer migration is missing marker: {marker}")
    agent_feed_test = (BASE / "db/tests/003_agent_feed_consumer.sql").read_text(encoding="utf-8").lower()
    for marker in (
        "duplicate agent feed event was not rejected",
        "must not directly publish/link a reward rule",
        "rollback;",
    ):
        if marker not in agent_feed_test:
            fail(f"Agent Feed consumer test is missing marker: {marker}")

    integration_doc = (BASE / "docs/15_agent_feed_integration.md").read_text(encoding="utf-8")
    for marker in ("separate project", "must not", "SourceObservation", "canonical evidence", "Realtime"):
        if marker not in integration_doc:
            fail(f"Agent Feed integration doc is missing marker: {marker}")
    supabase_doc = (BASE / "docs/16_supabase_stack_decision.md").read_text(encoding="utf-8")
    if "Realtime | Optional UX" not in supabase_doc or "separate Supabase project" not in supabase_doc:
        fail("Supabase decision must make Realtime optional and Agent Feed separately deployed")
    integration_prompt = (BASE / "prompts/CODEX_AGENT_FEED_INTEGRATION_PROMPT.md").read_text(encoding="utf-8")
    for marker in ("do not implement Agent Feed server code here", "do not query the Agent Feed database", "do not use Realtime for delivery"):
        if marker not in integration_prompt:
            fail(f"Agent Feed integration prompt is missing marker: {marker}")

    validate_docs_and_scripts()

    print("Foundation package v0.4.1 validation passed")
    print(f"  JSON Schemas: {len(schemas)}")
    print(f"  Trusted sources: {len(sources)}")
    print(f"  Source access observations: {len(observations)}")
    print(f"  Source review queue: {len(queue_ids)}")
    print(f"  Rehearsal sources: {len(rehearsal_ids)}")
    print(f"  Seed blueprints: {len(seeds['scenarios'])}")
    print(f"  Planned scenarios: {len(scenarios)}")
    print(f"  Level split: {dict(level_counts)}")
    print("  Synthetic valuation fixtures: reconciled with identical native ledgers, reversed winner, and verified break-even")
    print("  Semantic invalid-range self-tests: rejected as required")
    print("  Prompt-injection fixture: quarantined/no candidate rule")
    print("  SQL: structural checks passed (not executed against PostgreSQL)")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:
        print(f"VALIDATION FAILED: {exc}", file=sys.stderr)
        raise SystemExit(1)
