#!/usr/bin/env python3
"""Offline validator for Japan Rewards Optimizer Foundation Package v0.4.1.

The validator performs no network requests. It validates JSON Schema, examples,
registries, cross-references, semantic invariants, the prompt-injection fixture,
source-maintenance configuration, and load-bearing SQL structure. It does not
replace execution against PostgreSQL 15+.
"""

from __future__ import annotations

import copy
import hashlib
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
    "reward-claim.schema.json",
    "reward-rule.schema.json",
    "source-access-observation.schema.json",
    "source-observation.schema.json",
    "trusted-source-registry.schema.json",
    "trusted-source.schema.json",
    "user-state.schema.json",
}
EXPECTED_SOURCE_COUNT = 176
EXPECTED_SCENARIO_COUNT = 100
EXPECTED_LEVELS = Counter(
    {"L1_SINGLE_RULE": 40, "L2_STACKING": 40, "L3_ADVERSARIAL": 20}
)
EXPECTED_AGENT_FEED_SCHEMA_ARTIFACT = {
    "version": "0.1.1",
    "tag": "schema-v0.1.1",
    "source_commit": "ad7e1a7270d0ebc09ffdc844d38cfa71a87bf95e",
    "url": "https://github.com/wesleykao1990/agent-feed/releases/download/schema-v0.1.1/agent-feed-schema-0.1.1.tgz",
    "manifest_url": "https://github.com/wesleykao1990/agent-feed/releases/download/schema-v0.1.1/schema-artifact-manifest.json",
    "integrity": "sha512-KHALcE3zQ/dey5GTXepDeXaz77Qf1DP3ySA+rcbG6eiFvUTws21cry8rfM191wyLeQthJ9ENd0neu23ETwX5/g==",
    "sha256": "9e020aba4e291f2e5328897dfb07195aaf392f6ecdd742b5c13b890cffdd9d6e",
    "bytes": 13078,
}


class ValidationFailure(AssertionError):
    pass


def fail(message: str) -> None:
    raise ValidationFailure(message)


def load_json(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


def load_yaml(path: Path) -> Any:
    return yaml.safe_load(path.read_text(encoding="utf-8"))


def canonical_sha256(value: Any) -> str:
    encoded = json.dumps(
        value,
        ensure_ascii=False,
        separators=(",", ":"),
        sort_keys=True,
    ).encode("utf-8")
    return f"sha256:{hashlib.sha256(encoded).hexdigest()}"


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


def validate_agent_feed_protocol_lock(manifest: dict[str, Any]) -> None:
    lock_path = manifest["canonical_files"]["agent_feed_protocol_lock"]
    lock = load_json(BASE / lock_path)
    if lock.get("agent_feed_protocol_version") != "0.1":
        fail("Agent Feed protocol lock must pin protocol 0.1")
    if lock.get("agent_feed_project_version") != "0.1.1":
        fail("Agent Feed protocol lock must pin project version 0.1.1")
    if lock.get("schema_package") != "@agent-feed/schema":
        fail("Agent Feed protocol lock must pin @agent-feed/schema")
    if lock.get("schema_artifact") != EXPECTED_AGENT_FEED_SCHEMA_ARTIFACT:
        fail("Agent Feed schema artifact URL/integrity does not match the published 0.1.1 release")
    if lock.get("direct_database_access") is not False:
        fail("Agent Feed protocol lock must prohibit direct database access")
    if lock.get("realtime_required") is not False:
        fail("Agent Feed protocol lock must not require Realtime delivery")

    external = manifest.get("external_protocols", {}).get("agent_feed", {})
    if external.get("protocol_version") != lock["agent_feed_protocol_version"]:
        fail("Package manifest and Agent Feed protocol lock versions differ")
    if external.get("schema_artifact_lock") != lock_path:
        fail("Package manifest must point to the canonical Agent Feed protocol lock")
    if external.get("schema_artifact") != lock["schema_artifact"]:
        fail("Package manifest and Agent Feed schema artifact pin differ")


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
                    item.get("tax_exclusive_amount_jpy"),
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
    asset_definitions = scenario.get("asset_definitions")
    if not isinstance(asset_definitions, list):
        fail(f"{label}/asset_definitions: expected a list")
    asset_ids = [
        asset.get("asset_id") if isinstance(asset, dict) else None
        for asset in asset_definitions
    ]
    if any(not isinstance(asset_id, str) for asset_id in asset_ids):
        fail(f"{label}/asset_definitions: every asset requires an asset_id")
    duplicate_asset_ids = duplicate_values(asset_ids)
    if duplicate_asset_ids:
        fail(
            f"{label}/asset_definitions: duplicate asset definition IDs "
            f"{duplicate_asset_ids}"
        )
    validate_review_contract(
        scenario["review"],
        scenario["review"].get("decision") == "approved",
        f"{label}/review",
    )
    opening_lots = scenario["user_state"]["asset_lots"]
    opening_lot_ids = {lot["lot_id"] for lot in opening_lots}

    top_evidence_ids = set(scenario["evidence_ids"])
    bindings_by_rule: dict[str, dict[str, Any]] = {}
    for binding_index, binding in enumerate(scenario["rule_version_bindings"]):
        binding_label = f"{label}/rule_version_bindings/{binding_index}"
        rule_id = binding["rule_id"]
        if rule_id in bindings_by_rule:
            fail(f"{binding_label}: each result-visible rule ID must bind exactly one version")
        bindings_by_rule[rule_id] = binding
        if not set(binding["evidence_ids"]) <= top_evidence_ids:
            fail(f"{binding_label}: binding evidence is absent from scenario evidence_ids")

    replay_provenance = scenario["replay_provenance"]
    if (
        replay_provenance["rule_admission"] == "ephemeral_published_clone"
        and replay_provenance["publication_authorized"] is not False
    ):
        fail(f"{label}: ephemeral replay admission cannot authorize publication")

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

        origin = result["result_origin"]
        preflight = result["preflight_rejection"]
        if origin == "engine" and preflight is not None:
            fail(f"{result_label}: engine result cannot carry preflight rejection metadata")
        if origin == "preflight":
            if (
                result["eligible"] is not False
                or result["asset_movements"]
                or result["reward_components"]
                or result["ending_asset_lots"]
                or not isinstance(preflight, dict)
                or preflight.get("reward_calculation_performed") is not False
            ):
                fail(f"{result_label}: preflight result must be ineligible with empty ledgers")

        for field, role in (
            ("applied_rule_ids", "applied"),
            ("rejected_rule_ids", "rejected"),
        ):
            for rule_id in result[field]:
                binding = bindings_by_rule.get(rule_id)
                if binding is None or role not in binding["roles"]:
                    fail(f"{result_label}: {field} lacks an exact {role} rule binding")

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


def validate_golden_manifest(
    fixture: dict[str, Any],
    manifest: dict[str, Any],
    label: str,
) -> None:
    if manifest["scenario_id"] != fixture["scenario_id"]:
        fail(f"{label}: manifest scenario ID does not match fixture")
    if manifest["canonical_fixture_hash"] != canonical_sha256(fixture):
        fail(f"{label}: canonical fixture hash mismatch")
    result_hash_rows = manifest.get("result_artifact_hashes")
    if not isinstance(result_hash_rows, list):
        fail(f"{label}: result hash manifest must be a list")
    result_hash_plan_ids = [row.get("plan_id") for row in result_hash_rows]
    if any(not isinstance(plan_id, str) for plan_id in result_hash_plan_ids):
        fail(f"{label}: result hash manifest contains a missing/invalid plan ID")
    if duplicate_values(result_hash_plan_ids):
        fail(f"{label}: result hash manifest contains duplicate plan IDs")
    result_hashes = {
        row["plan_id"]: row.get("result_artifact_hash")
        for row in result_hash_rows
    }
    results = fixture["expected"]["plan_results"]
    if set(result_hashes) != {result["plan_id"] for result in results}:
        fail(f"{label}: result hash manifest does not cover every plan exactly once")
    for result in results:
        projection = copy.deepcopy(result)
        embedded_hash = projection.pop("result_artifact_hash", None)
        computed_hash = canonical_sha256(projection)
        if embedded_hash != computed_hash or result_hashes[result["plan_id"]] != computed_hash:
            fail(f"{label}: result artifact hash mismatch for {result['plan_id']}")

    replay_hashes = manifest.get("replay_hashes")
    if not isinstance(replay_hashes, dict):
        fail(f"{label}: replay_hashes are required for independent provenance validation")
    if set(replay_hashes) != {"input_hash", "output_hash"}:
        fail(f"{label}: replay_hashes contain missing or unsupported fields")

    replay_input = build_golden_replay_input_projection(fixture, manifest, label)
    computed_input_hash = canonical_sha256(replay_input)
    if computed_input_hash != replay_hashes["input_hash"]:
        fail(f"{label}: independently reconstructed replay input hash disagrees with manifest")
    if computed_input_hash != fixture["replay_provenance"]["input_hash"]:
        fail(f"{label}: independently reconstructed replay input hash disagrees with fixture provenance")

    replay_output = build_golden_replay_output_projection(fixture, manifest, label)
    computed_output_hash = canonical_sha256(replay_output)
    if computed_output_hash != replay_hashes["output_hash"]:
        fail(f"{label}: independently reconstructed replay output hash disagrees with manifest")
    if computed_output_hash != fixture["replay_provenance"]["output_hash"]:
        fail(f"{label}: independently reconstructed replay output hash disagrees with fixture provenance")


def _require_exact_keys(value: Any, expected: set[str], label: str) -> dict[str, Any]:
    if not isinstance(value, dict):
        fail(f"{label}: expected an object")
    actual = set(value)
    missing = sorted(expected - actual)
    extra = sorted(actual - expected)
    if missing or extra:
        fail(f"{label}: unsupported projection fields (missing={missing}, extra={extra})")
    return value


def _fixture_projection_value(
    fixture: dict[str, Any], path: str, label: str
) -> Any:
    current: Any = fixture
    for part in path.split("."):
        if not isinstance(current, dict) or part not in current:
            fail(f"{label}: fixture projection path is unavailable: {path}")
        current = current[part]
    return copy.deepcopy(current)


def _validate_replay_rule_projection(
    fixture: dict[str, Any], rules: Any, label: str
) -> None:
    if not isinstance(rules, list) or not rules:
        fail(f"{label}: replay input must declare a non-empty rules projection")
    bindings = fixture.get("rule_version_bindings")
    if not isinstance(bindings, list):
        fail(f"{label}: fixture rule_version_bindings are required")
    binding_by_id: dict[str, dict[str, Any]] = {}
    for binding in bindings:
        if not isinstance(binding, dict) or not isinstance(binding.get("rule_id"), str):
            fail(f"{label}: fixture rule binding is malformed")
        rule_id = binding["rule_id"]
        if rule_id in binding_by_id:
            fail(f"{label}: fixture rule bindings contain duplicate rule IDs")
        binding_by_id[rule_id] = binding

    seen_rule_ids: list[str] = []
    for index, rule in enumerate(rules):
        rule_label = f"{label}/context/rules/{index}"
        if not isinstance(rule, dict) or not isinstance(rule.get("rule_id"), str):
            fail(f"{rule_label}: replay rule is malformed")
        rule_id = rule["rule_id"]
        seen_rule_ids.append(rule_id)
        binding = binding_by_id.get(rule_id)
        if binding is None:
            fail(f"{rule_label}: replay rule has no fixture binding")
        if rule.get("status") != "published":
            fail(f"{rule_label}: replay admission must use a published ephemeral clone")
        if rule.get("version") != binding.get("version"):
            fail(f"{rule_label}: replay rule version disagrees with fixture binding")
        if rule.get("validity") != binding.get("validity"):
            fail(f"{rule_label}: replay rule validity disagrees with fixture binding")
        provenance = rule.get("provenance")
        if not isinstance(provenance, dict):
            fail(f"{rule_label}: replay rule provenance is missing")
        if provenance.get("evidence_ids") != binding.get("evidence_ids"):
            fail(f"{rule_label}: replay rule evidence disagrees with fixture binding")
        definition = copy.deepcopy(rule)
        for field in (
            "version",
            "status",
            "validity",
            "provenance",
            "audit",
            "definition_hash",
        ):
            definition.pop(field, None)
        if canonical_sha256(definition) != binding.get("definition_hash"):
            fail(f"{rule_label}: replay rule definition hash disagrees with fixture binding")

    if duplicate_values(seen_rule_ids) or set(seen_rule_ids) != set(binding_by_id):
        fail(f"{label}: replay rule projection must cover every fixture binding exactly once")


def build_golden_replay_input_projection(
    fixture: dict[str, Any], manifest: dict[str, Any], label: str
) -> dict[str, Any]:
    projection = manifest.get("replay_input_projection")
    projection = _require_exact_keys(
        projection,
        {"projection_version", "base_context", "fixture_bindings"},
        f"{label}/replay_input_projection",
    )
    if projection["projection_version"] != "engine_candidates_input.v1":
        fail(f"{label}: unsupported replay input projection version")
    bindings = _require_exact_keys(
        projection["fixture_bindings"],
        {
            "plans",
            "context.asset_definitions",
            "context.user_state",
            "context.user_state.asset_lots",
            "context.user_state.valuation_profile.entries",
            "context.objective",
            "context.replay_knowledge_at",
            "context.transaction_time",
        },
        f"{label}/replay_input_projection/fixture_bindings",
    )
    expected_bindings = {
        "plans": (
            "candidate_plans"
            if fixture["scenario_id"] == "JP-CVS-002"
            else "candidate_plans[engine_origin]"
        ),
        "context.asset_definitions": "asset_definitions",
        "context.user_state": "user_state",
        "context.user_state.asset_lots": "user_state.asset_lots",
        "context.user_state.valuation_profile.entries":
            "user_state.valuation_profile.entries",
        "context.objective": "objective",
        "context.replay_knowledge_at": "replay_knowledge_at",
        "context.transaction_time": "as_of",
    }
    if bindings != expected_bindings:
        fail(f"{label}: replay input fixture bindings are unsupported")

    base_context = _require_exact_keys(
        projection["base_context"],
        {"rules"},
        f"{label}/replay_input_projection/base_context",
    )
    _validate_replay_rule_projection(fixture, base_context["rules"], label)

    context: dict[str, Any] = {"rules": copy.deepcopy(base_context["rules"])}
    replay_input: dict[str, Any] = {"plans": [], "context": context}
    for target, source in expected_bindings.items():
        if source == "candidate_plans[engine_origin]":
            engine_plan_ids = [
                result["plan_id"]
                for result in fixture["expected"]["plan_results"]
                if result.get("result_origin") == "engine"
            ]
            candidate_plans = fixture.get("candidate_plans")
            if not isinstance(candidate_plans, list):
                fail(f"{label}: candidate plan projection is not a list")
            plans_by_id = {plan.get("plan_id"): plan for plan in candidate_plans}
            if len(plans_by_id) != len(candidate_plans) or any(
                plan_id not in plans_by_id for plan_id in engine_plan_ids
            ):
                fail(f"{label}: engine-origin plan projection is incomplete or ambiguous")
            value = [copy.deepcopy(plans_by_id[plan_id]) for plan_id in engine_plan_ids]
        else:
            value = _fixture_projection_value(fixture, source, f"{label}/replay_input_projection")
        if target == "plans":
            replay_input["plans"] = value
        elif target == "context.asset_definitions":
            context["assets"] = value
        elif target == "context.user_state":
            context["user_state"] = value
        elif target == "context.user_state.asset_lots":
            if context.get("user_state", {}).get("asset_lots") != value:
                fail(f"{label}: user-state asset-lot binding disagrees with user_state")
            if fixture["scenario_id"] == "JP-CVS-006":
                context["opening_asset_lots"] = copy.deepcopy(value)
        elif target == "context.user_state.valuation_profile.entries":
            user_state = context.get("user_state")
            if not isinstance(user_state, dict):
                fail(f"{label}: valuation binding requires user_state")
            profile = user_state.get("valuation_profile")
            if not isinstance(profile, dict) or profile.get("entries") != value:
                fail(f"{label}: valuation binding disagrees with user_state")
        else:
            context[target.removeprefix("context.")] = value
    return replay_input


def _native_integer(value: Any, label: str) -> int:
    if isinstance(value, bool):
        fail(f"{label}: boolean is not an integer")
    if isinstance(value, int):
        integer = value
    elif isinstance(value, float):
        if not value.is_integer():
            fail(f"{label}: fractional numeric value is not supported")
        integer = int(value)
    elif isinstance(value, str) and re.fullmatch(r"-?[0-9]+(?:\.0+)?", value):
        integer = int(value.split(".", 1)[0])
    else:
        fail(f"{label}: unsupported integer representation")
    if not -(2**53 - 1) <= integer <= 2**53 - 1:
        fail(f"{label}: integer exceeds the safe JSON range")
    return integer


def _native_range(value: Any, label: str) -> dict[str, int | None]:
    value = _require_exact_keys(
        value,
        {"minimum_jpy", "maximum_jpy", "expected_jpy"},
        label,
    )
    minimum = _native_integer(value["minimum_jpy"], f"{label}/minimum_jpy")
    maximum = _native_integer(value["maximum_jpy"], f"{label}/maximum_jpy")
    expected = (
        None
        if value["expected_jpy"] is None
        else _native_integer(value["expected_jpy"], f"{label}/expected_jpy")
    )
    if minimum > maximum or (expected is not None and not minimum <= expected <= maximum):
        fail(f"{label}: invalid numeric range")
    return {
        "minimum_jpy": minimum,
        "maximum_jpy": maximum,
        "expected_jpy": expected,
    }


def _project_native_reward_component(
    reward: Any, label: str
) -> dict[str, Any]:
    reward = _require_exact_keys(
        reward,
        {
            "component_id",
            "operation_id",
            "rule_id",
            "sign",
            "quantity",
            "value_jpy",
            "value_jpy_decimal",
            "certainty",
            "settlement",
            "expiry",
            "restrictions",
            "clawback",
            "calculation_trace",
        },
        label,
    )
    value_jpy = _native_range(reward["value_jpy"], f"{label}/value_jpy")
    helper_value = _native_integer(
        reward["value_jpy_decimal"], f"{label}/value_jpy_decimal"
    )
    if value_jpy["expected_jpy"] != helper_value:
        fail(f"{label}: native decimal helper disagrees with value_jpy")
    return {
        "component_id": reward["component_id"],
        "operation_id": reward["operation_id"],
        "rule_id": reward["rule_id"],
        "sign": reward["sign"],
        "quantity": copy.deepcopy(reward["quantity"]),
        "value_jpy": value_jpy,
        "certainty": copy.deepcopy(reward["certainty"]),
        "settlement": copy.deepcopy(reward["settlement"]),
        "expiry": copy.deepcopy(reward["expiry"]),
        "restrictions": copy.deepcopy(reward["restrictions"]),
        "clawback": copy.deepcopy(reward["clawback"]),
        "calculation_trace": copy.deepcopy(reward["calculation_trace"]),
    }


def _project_native_plan_result(native: Any, label: str) -> dict[str, Any]:
    native = _require_exact_keys(
        native,
        {
            "plan_id",
            "eligible",
            "asset_movements",
            "reward_components",
            "ending_asset_lots",
            "economics",
            "objective_score_jpy",
            "applied_rule_ids",
            "rejected_rule_ids",
            "rejection_reasons",
            "external_funding_jpy",
            "merchant_value_jpy",
            "native_snapshot",
            "opening_asset_units_consumed",
            "operations",
        },
        label,
    )
    economics = _require_exact_keys(
        native["economics"],
        {
            "merchant_value_received_jpy",
            "external_funding_jpy",
            "opening_asset_value_consumed_jpy",
            "ending_asset_value_jpy",
            "guaranteed_reward_value_jpy",
            "probabilistic_expected_reward_value_jpy",
            "fee_value_jpy",
            "guaranteed_net_value_change_jpy",
            "expected_net_value_change_jpy",
        },
        f"{label}/economics",
    )
    projected_rejections: list[str] = []
    if not isinstance(native["rejection_reasons"], list):
        fail(f"{label}/rejection_reasons: expected a list")
    for index, reason in enumerate(native["rejection_reasons"]):
        reason = _require_exact_keys(
            reason,
            {"code", "message", "operation_id", "rule_id"},
            f"{label}/rejection_reasons/{index}",
        )
        if not isinstance(reason["message"], str):
            fail(f"{label}/rejection_reasons/{index}: message must be a string")
        projected_rejections.append(reason["message"])
    return {
        "plan_id": native["plan_id"],
        "eligible": native["eligible"],
        "asset_movements": copy.deepcopy(native["asset_movements"]),
        "reward_components": [
            _project_native_reward_component(reward, f"{label}/reward_components/{index}")
            for index, reward in enumerate(native["reward_components"])
        ],
        "ending_asset_lots": copy.deepcopy(native["ending_asset_lots"]),
        "economics": {
            field: _native_range(value, f"{label}/economics/{field}")
            for field, value in economics.items()
        },
        "objective_score_jpy": {
            "minimum_jpy": _native_integer(
                native["objective_score_jpy"], f"{label}/objective_score_jpy"
            ),
            "maximum_jpy": _native_integer(
                native["objective_score_jpy"], f"{label}/objective_score_jpy"
            ),
            "expected_jpy": _native_integer(
                native["objective_score_jpy"], f"{label}/objective_score_jpy"
            ),
        },
        "nominal_return_basis_points": None,
        "applied_rule_ids": copy.deepcopy(native["applied_rule_ids"]),
        "rejected_rule_ids": copy.deepcopy(native["rejected_rule_ids"]),
        "rejection_reasons": projected_rejections,
    }


def build_golden_replay_output_projection(
    fixture: dict[str, Any], manifest: dict[str, Any], label: str
) -> dict[str, Any]:
    projection = manifest.get("replay_output_projection")
    projection = _require_exact_keys(
        projection,
        {"projection_version", "mode", "fixture_bindings"}
        if fixture["scenario_id"] == "JP-CVS-002"
        else {"projection_version", "mode", "fixture_binding", "canonical_output"},
        f"{label}/replay_output_projection",
    )
    if projection["projection_version"] != "golden_replay_output.v1":
        fail(f"{label}: unsupported replay output projection version")

    results = fixture["expected"]["plan_results"]
    engine_ids = [result["plan_id"] for result in results if result.get("result_origin") == "engine"]
    preflight_ids = [result["plan_id"] for result in results if result.get("result_origin") == "preflight"]
    if not engine_ids:
        fail(f"{label}: replay output projection has no engine-origin result")

    if projection["mode"] == "fixture_expected":
        if fixture["scenario_id"] != "JP-CVS-002":
            fail(f"{label}: fixture_expected replay output mode is unsupported for this fixture")
        bindings = _require_exact_keys(
            projection["fixture_bindings"],
            {
                "outcome_mode",
                "definite_winner_plan_id",
                "safe_plan_id",
                "runner_up_plan_id",
                "plan_results",
            },
            f"{label}/replay_output_projection/fixture_bindings",
        )
        expected_bindings = {
            "outcome_mode": "expected.outcome_mode",
            "definite_winner_plan_id": "expected.definite_winner_plan_id",
            "safe_plan_id": "expected.safe_plan_id",
            "runner_up_plan_id": "expected.runner_up_plan_id",
            "plan_results": "expected.plan_results",
        }
        if bindings != expected_bindings:
            fail(f"{label}: replay output fixture bindings are unsupported")
        if preflight_ids or len(engine_ids) != len(results):
            fail(f"{label}: fixture_expected output must contain engine-origin results only")
        return {
            key: _fixture_projection_value(fixture, source, f"{label}/replay_output_projection")
            for key, source in expected_bindings.items()
        }

    if projection["mode"] != "manifest_engine_canonical":
        fail(f"{label}: unsupported replay output projection mode")
    if projection["fixture_binding"] != "expected.plan_results":
        fail(f"{label}: engine replay output must bind to expected.plan_results")
    canonical_output = projection["canonical_output"]
    if not isinstance(canonical_output, dict):
        fail(f"{label}: canonical engine output projection must be an object")
    expected_output_keys = {
        "conditional_winners",
        "definite_winner_plan_id",
        "explanation_tokens",
        "outcome_mode",
        "plans",
        "questions_to_resolve",
        "runner_up",
        "safe_plan_id",
        "valuation_sensitivities",
        "winner",
    }
    _require_exact_keys(canonical_output, expected_output_keys, f"{label}/replay_output_projection/canonical_output")
    native_plans = canonical_output["plans"]
    if not isinstance(native_plans, list):
        fail(f"{label}: canonical engine output plans must be a list")
    native_plan_ids = [plan.get("plan_id") for plan in native_plans if isinstance(plan, dict)]
    if any(not isinstance(plan_id, str) for plan_id in native_plan_ids):
        fail(f"{label}: canonical engine output contains a malformed plan")
    if duplicate_values(native_plan_ids) or native_plan_ids != engine_ids:
        fail(f"{label}: canonical engine output must contain exactly the engine-origin plan results")
    if set(native_plan_ids) & set(preflight_ids):
        fail(f"{label}: preflight-only plan was represented as engine output")
    if canonical_output["definite_winner_plan_id"] not in engine_ids:
        fail(f"{label}: canonical engine output winner is not engine-origin")
    if canonical_output["safe_plan_id"] not in engine_ids:
        fail(f"{label}: canonical engine output safe plan is not engine-origin")
    for field in ("winner", "runner_up"):
        candidate = canonical_output[field]
        if candidate is not None and (
            not isinstance(candidate, dict)
            or candidate.get("plan_id") not in engine_ids
        ):
            fail(f"{label}: canonical engine output {field} is not engine-origin")

    expected = fixture["expected"]
    for field in (
        "outcome_mode",
        "definite_winner_plan_id",
        "safe_plan_id",
        "conditional_winners",
    ):
        if canonical_output[field] != expected[field]:
            fail(f"{label}: canonical engine output {field} disagrees with fixture expectation")
    if canonical_output["runner_up"] is not None and (
        canonical_output["runner_up"].get("plan_id")
        != expected["runner_up_plan_id"]
    ):
        fail(f"{label}: canonical engine output runner_up disagrees with fixture expectation")
    if canonical_output["runner_up"] is None and expected["runner_up_plan_id"] is not None:
        fail(f"{label}: canonical engine output runner_up is missing")

    golden_by_id = {
        result["plan_id"]: result
        for result in results
        if result.get("result_origin") == "engine"
    }
    candidate_by_id = {
        plan["plan_id"]: plan
        for plan in fixture["candidate_plans"]
        if plan.get("plan_id") in engine_ids
    }
    for index, native_plan in enumerate(native_plans):
        plan_id = native_plan["plan_id"]
        golden = golden_by_id.get(plan_id)
        if golden is None:
            fail(f"{label}: canonical engine output plan has no engine-origin golden result")
        candidate = candidate_by_id.get(plan_id)
        if candidate is None:
            fail(f"{label}: canonical engine output plan has no fixture candidate")
        if native_plan.get("operations") != candidate.get("operations"):
            fail(f"{label}: native plan operations disagree with fixture candidate")
        projected_native = _project_native_plan_result(
            native_plan, f"{label}/replay_output_projection/plans/{index}"
        )
        golden_without_metadata = copy.deepcopy(golden)
        for field in ("result_artifact_hash", "result_origin", "preflight_rejection"):
            golden_without_metadata.pop(field, None)
        if projected_native != golden_without_metadata:
            fail(f"{label}: native engine plan does not exactly project to golden result {plan_id}")

    native_by_id = {plan["plan_id"]: plan for plan in native_plans}
    for field, plan_id_field in (("winner", "definite_winner_plan_id"), ("runner_up", "runner_up_plan_id")):
        expected_plan_id = expected[plan_id_field]
        native_reference = canonical_output[field]
        if expected_plan_id is None:
            if native_reference is not None:
                fail(f"{label}: canonical engine output {field} should be null")
        elif native_reference != native_by_id.get(expected_plan_id):
            fail(f"{label}: canonical engine output {field} disagrees with its native plan")
    return copy.deepcopy(canonical_output)



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
        "ambiguous generated replay pair",
        "generate_series(0, 28)",
        "expected exactly one adjacent replay result at boundary",
        "2026-04-01t00:00:00z",
        "rollback;",
    ):
        if marker not in replay_test:
            fail(f"bitemporal replay integration test is missing marker: {marker}")

    view_test = (BASE / "db/tests/002_view_security.sql").read_text(encoding="utf-8").lower()
    for marker in (
        "verified_sources unexpectedly succeeded without underlying grants",
        "approved_reward_rule_versions unexpectedly succeeded without underlying grants",
        "security_invoker=true and security_barrier=true",
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


def validate_m3_manual_evidence(
    manifest: dict[str, Any],
    schemas: dict[str, dict[str, Any]],
    schema_registry: Registry,
    sources: list[dict[str, Any]],
) -> None:
    index = load_json(BASE / "fixtures/m3/real-data-alpha-evidence-index.v0.1.json")
    records = index["records"]
    expected_count = manifest["counts"]["m3_verified_evidence_records"]
    if len(records) != expected_count:
        fail("M3 evidence index count does not match the package manifest")
    source_by_id = {source["id"]: source for source in sources}
    evidence_ids: list[str] = []
    snapshot_ids: list[str] = []
    indexed_evidence_paths: set[str] = set()
    indexed_snapshot_paths: set[str] = set()
    for index_number, item in enumerate(records):
        label = f"m3-evidence-index/records/{index_number}"
        evidence_path = BASE / item["evidence_path"]
        snapshot_path = BASE / item["snapshot_path"]
        if not evidence_path.is_file() or not snapshot_path.is_file():
            fail(f"{label}: indexed evidence or snapshot file does not exist")
        indexed_evidence_paths.add(evidence_path.relative_to(BASE).as_posix())
        indexed_snapshot_paths.add(snapshot_path.relative_to(BASE).as_posix())
        evidence = load_yaml(evidence_path)
        snapshot_bytes = snapshot_path.read_bytes()
        snapshot = json.loads(snapshot_bytes)
        validate_schema(
            evidence,
            schemas["evidence-record.schema.json"],
            schema_registry,
            evidence_path.relative_to(BASE).as_posix(),
        )
        validate_review_contract(
            evidence["review"],
            evidence["status"] == "verified",
            f"{evidence_path.relative_to(BASE).as_posix()}/review",
        )
        if evidence["status"] != "verified":
            fail(f"{label}: reviewed real-data alpha evidence must be verified")
        if evidence["review"].get("decision") != "approved":
            fail(f"{label}: reviewed real-data alpha evidence must be approved")
        source = source_by_id.get(evidence["source_id"])
        if source is None:
            fail(f"{label}: evidence references an unknown source")
        if evidence["source_url"] != source["source_url"]:
            fail(f"{label}: evidence URL does not match the trusted source")
        if snapshot.get("record_type") != "normalized_manual_source_snapshot":
            fail(f"{label}: snapshot is not a normalized manual source snapshot")
        if snapshot.get("raw_page_body_stored") is not False:
            fail(f"{label}: raw page content must not be stored")
        if snapshot.get("source_id") != evidence["source_id"]:
            fail(f"{label}: snapshot and evidence source IDs differ")
        if snapshot.get("source_url") != evidence["source_url"]:
            fail(f"{label}: snapshot and evidence URLs differ")
        if snapshot.get("source_snapshot_id") != evidence["source_snapshot_id"]:
            fail(f"{label}: snapshot and evidence snapshot IDs differ")
        if snapshot.get("captured_at") != evidence["captured_at"]:
            fail(f"{label}: snapshot and evidence capture times differ")
        if snapshot.get("capture_method") != evidence["capture_method"]:
            fail(f"{label}: snapshot and evidence capture methods differ")
        facts = snapshot.get("facts")
        if not isinstance(facts, list) or not facts:
            fail(f"{label}: normalized snapshot must contain facts")
        if any(fact.get("status") != "extracted_pending_review" for fact in facts):
            fail(f"{label}: immutable capture-time fact status changed unexpectedly")
        expected_hash = "sha256:" + hashlib.sha256(snapshot_bytes).hexdigest()
        if evidence["content_hash"] != expected_hash:
            fail(f"{label}: evidence hash does not bind the stored normalized snapshot")
        if item["evidence_id"] != evidence["evidence_id"]:
            fail(f"{label}: indexed evidence ID differs from the evidence record")
        if item["source_snapshot_id"] != evidence["source_snapshot_id"]:
            fail(f"{label}: indexed snapshot ID differs from the evidence record")
        evidence_ids.append(evidence["evidence_id"])
        snapshot_ids.append(evidence["source_snapshot_id"])
    if duplicate_values(evidence_ids) or duplicate_values(snapshot_ids):
        fail("M3 evidence index contains duplicate evidence or snapshot IDs")
    actual_evidence_paths = {
        path.relative_to(BASE).as_posix()
        for path in (BASE / "fixtures/m3/evidence").glob("*.yaml")
    }
    actual_snapshot_paths = {
        path.relative_to(BASE).as_posix()
        for path in (BASE / "fixtures/m3/source-snapshots").glob("*.json")
    }
    if actual_evidence_paths != indexed_evidence_paths:
        fail("M3 evidence index does not exactly cover the evidence directory")
    if actual_snapshot_paths != indexed_snapshot_paths:
        fail("M3 evidence index does not exactly cover the snapshot directory")


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
    validate_agent_feed_protocol_lock(manifest)

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

    validate_m3_manual_evidence(
        manifest,
        schemas,
        schema_registry,
        sources,
    )

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

    for scenario_id in ("jp-cvs-002", "jp-cvs-006"):
        fixture_path = BASE / "fixtures/m3/real-data" / scenario_id / "golden-scenario.v1.json"
        manifest_path = fixture_path.with_name("golden-scenario.v1.manifest.json")
        real_golden = load_json(fixture_path)
        real_manifest = load_json(manifest_path)
        label = str(fixture_path.relative_to(BASE))
        validate_schema(
            real_golden,
            schemas["golden-scenario.schema.json"],
            schema_registry,
            label,
        )
        validate_golden_scenario(real_golden, label)
        validate_golden_manifest(real_golden, real_manifest, label)

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
    print("  Real golden fixtures: JP-CVS-002 and JP-CVS-006 schema/semantics/canonical manifests verified")
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
