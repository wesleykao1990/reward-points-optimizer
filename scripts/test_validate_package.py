#!/usr/bin/env python3
"""Focused hostile regressions for the offline golden-fixture validator."""

from __future__ import annotations

import copy
import importlib.util
import unittest
from pathlib import Path
from types import ModuleType
from typing import Any


BASE = Path(__file__).resolve().parents[1]


def load_validator() -> ModuleType:
    spec = importlib.util.spec_from_file_location(
        "validate_package_under_test", BASE / "scripts/validate_package.py"
    )
    if spec is None or spec.loader is None:
        raise RuntimeError("validator_module_unavailable")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


VALIDATOR = load_validator()


def load_pair(scenario_id: str) -> tuple[dict[str, Any], dict[str, Any]]:
    fixture_path = BASE / "fixtures/m3/real-data" / scenario_id / "golden-scenario.v1.json"
    return VALIDATOR.load_json(fixture_path), VALIDATOR.load_json(
        fixture_path.with_name("golden-scenario.v1.manifest.json")
    )


class GoldenProvenanceValidationTests(unittest.TestCase):
    def assert_rejected(
        self, fixture: dict[str, Any], manifest: dict[str, Any]
    ) -> None:
        with self.assertRaises(VALIDATOR.ValidationFailure):
            VALIDATOR.validate_golden_manifest(fixture, manifest, "hostile-fixture")

    def refresh_fixture_hash(self, fixture: dict[str, Any], manifest: dict[str, Any]) -> None:
        manifest["canonical_fixture_hash"] = VALIDATOR.canonical_sha256(fixture)

    def refresh_output_provenance(
        self, fixture: dict[str, Any], manifest: dict[str, Any]
    ) -> None:
        output_hash = VALIDATOR.canonical_sha256(
            manifest["replay_output_projection"]["canonical_output"]
        )
        manifest["replay_hashes"]["output_hash"] = output_hash
        fixture["replay_provenance"]["output_hash"] = output_hash
        self.refresh_fixture_hash(fixture, manifest)

    def test_forged_input_hash_fails_after_canonical_fixture_refresh(self) -> None:
        fixture, manifest = load_pair("JP-CVS-002")
        hostile = copy.deepcopy(fixture)
        hostile["candidate_plans"][0]["assumptions"][0] = "forged replay input"
        refreshed_manifest = copy.deepcopy(manifest)
        self.refresh_fixture_hash(hostile, refreshed_manifest)
        self.assert_rejected(hostile, refreshed_manifest)

    def test_forged_output_hash_fails_after_result_and_fixture_hash_refresh(self) -> None:
        fixture, manifest = load_pair("JP-CVS-002")
        hostile = copy.deepcopy(fixture)
        refreshed_manifest = copy.deepcopy(manifest)
        result = hostile["expected"]["plan_results"][0]
        result["objective_score_jpy"]["expected_jpy"] = 1
        without_hash = copy.deepcopy(result)
        without_hash.pop("result_artifact_hash")
        result_hash = VALIDATOR.canonical_sha256(without_hash)
        result["result_artifact_hash"] = result_hash
        for row in refreshed_manifest["result_artifact_hashes"]:
            if row["plan_id"] == result["plan_id"]:
                row["result_artifact_hash"] = result_hash
        self.refresh_fixture_hash(hostile, refreshed_manifest)
        self.assert_rejected(hostile, refreshed_manifest)

    def test_forged_input_provenance_value_fails_after_fixture_hash_refresh(self) -> None:
        fixture, manifest = load_pair("JP-CVS-002")
        hostile = copy.deepcopy(fixture)
        refreshed_manifest = copy.deepcopy(manifest)
        hostile["replay_provenance"]["input_hash"] = "sha256:" + "0" * 64
        self.refresh_fixture_hash(hostile, refreshed_manifest)
        self.assert_rejected(hostile, refreshed_manifest)

    def test_forged_output_provenance_value_fails_after_fixture_hash_refresh(self) -> None:
        fixture, manifest = load_pair("JP-CVS-006")
        hostile = copy.deepcopy(fixture)
        refreshed_manifest = copy.deepcopy(manifest)
        hostile["replay_provenance"]["output_hash"] = "sha256:" + "f" * 64
        self.refresh_fixture_hash(hostile, refreshed_manifest)
        self.assert_rejected(hostile, refreshed_manifest)

    def test_extra_projection_declaration_fails_closed(self) -> None:
        fixture, manifest = load_pair("JP-CVS-006")
        hostile = copy.deepcopy(manifest)
        hostile["replay_input_projection"]["unsupported"] = True
        self.assert_rejected(fixture, hostile)

    def test_preflight_plan_cannot_be_declared_engine_output(self) -> None:
        fixture, manifest = load_pair("JP-CVS-006")
        hostile = copy.deepcopy(manifest)
        hostile["replay_output_projection"]["canonical_output"]["plans"].append(
            {"plan_id": "plan_jp_cvs_006_invalid_4000_topup"}
        )
        self.assert_rejected(fixture, hostile)

    def test_manifest_asset_copy_is_rejected_even_when_fixture_hash_is_current(self) -> None:
        fixture, manifest = load_pair("JP-CVS-006")
        hostile = copy.deepcopy(manifest)
        hostile["replay_input_projection"]["base_context"]["assets"] = copy.deepcopy(
            fixture["asset_definitions"]
        )
        hostile["replay_input_projection"]["base_context"]["assets"][0][
            "display_name"
        ] = "forged asset"
        self.refresh_fixture_hash(fixture, hostile)
        self.assert_rejected(fixture, hostile)

    def test_manifest_valuation_copy_is_rejected_even_when_fixture_hash_is_current(self) -> None:
        fixture, manifest = load_pair("JP-CVS-006")
        hostile = copy.deepcopy(manifest)
        hostile["replay_input_projection"]["base_context"]["valuation_profile"] = {
            "entries": [{"jpy_per_unit": "999"}]
        }
        self.refresh_fixture_hash(fixture, hostile)
        self.assert_rejected(fixture, hostile)

    def test_duplicate_fixture_asset_definition_fails_after_coherent_hash_refresh(self) -> None:
        fixture, manifest = load_pair("JP-CVS-006")
        hostile_fixture = copy.deepcopy(fixture)
        hostile_manifest = copy.deepcopy(manifest)
        hostile_fixture["asset_definitions"].append(
            copy.deepcopy(hostile_fixture["asset_definitions"][0])
        )
        replay_input = VALIDATOR.build_golden_replay_input_projection(
            hostile_fixture, hostile_manifest, "hostile-fixture"
        )
        input_hash = VALIDATOR.canonical_sha256(replay_input)
        hostile_fixture["replay_provenance"]["input_hash"] = input_hash
        hostile_manifest["replay_hashes"]["input_hash"] = input_hash
        self.refresh_fixture_hash(hostile_fixture, hostile_manifest)
        with self.assertRaises(VALIDATOR.ValidationFailure):
            VALIDATOR.validate_golden_scenario(hostile_fixture, "hostile-fixture")

    def test_native_reward_amount_must_match_fixture_golden_result(self) -> None:
        fixture, manifest = load_pair("JP-CVS-006")
        hostile_fixture = copy.deepcopy(fixture)
        hostile = copy.deepcopy(manifest)
        reward = hostile["replay_output_projection"]["canonical_output"]["plans"][0][
            "reward_components"
        ][0]
        reward["quantity"]["amount"] = "999"
        reward["value_jpy"] = {
            "minimum_jpy": "999",
            "maximum_jpy": "999",
            "expected_jpy": "999",
        }
        reward["value_jpy_decimal"] = "999"
        self.refresh_output_provenance(hostile_fixture, hostile)
        self.assert_rejected(hostile_fixture, hostile)

    def test_native_winner_details_must_match_fixture_golden_result(self) -> None:
        fixture, manifest = load_pair("JP-CVS-006")
        hostile_fixture = copy.deepcopy(fixture)
        hostile = copy.deepcopy(manifest)
        native = hostile["replay_output_projection"]["canonical_output"]["plans"][0]
        native["objective_score_jpy"] = "999"
        hostile["replay_output_projection"]["canonical_output"]["winner"][
            "objective_score_jpy"
        ] = "999"
        self.refresh_output_provenance(hostile_fixture, hostile)
        self.assert_rejected(hostile_fixture, hostile)


if __name__ == "__main__":
    unittest.main()
