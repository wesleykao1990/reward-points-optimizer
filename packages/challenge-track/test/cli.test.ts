import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import YAML from "yaml";
import {
  buildChallengeTrackCliAudit,
  ChallengeTrackCliError,
  readAndBuildChallengeTrackCliAudit,
  runCli,
  validateTrustedSourceIds,
} from "../src/cli.js";

const root = new URL("../../../", import.meta.url).pathname;

describe("M7 challenge-track CLI", () => {
  it("admits canonical plan sources and reports declarations only", () => {
    const audit = readAndBuildChallengeTrackCliAudit({ cwd: root });
    expect(audit.audit_version).toBe("m7.challenge-track-cli-audit.v1");
    expect(audit.declared_target_count).toBe(100);
    expect(audit.planned_target_count).toBe(100);
    expect(audit.bound_target_count).toBe(0);
    expect(audit.executed_count).toBe(0);
    expect(audit.evidence_backed_count).toBe(0);
    expect(audit.golden_count).toBe(0);
    expect(audit.production_ready).toBe(false);
    expect(audit.source_validation.valid).toBe(true);
    expect(audit.source_validation.registry_source_count).toBeGreaterThan(0);
  });

  it("emits stable JSON with no execution or promotion claim", () => {
    const first = runCli({ cwd: root });
    const second = runCli({ cwd: root });
    expect(first).toBe(second);
    const value = JSON.parse(first) as Record<string, unknown>;
    expect(value.declared_target_count).toBe(100);
    expect(value.executed_count).toBe(0);
    expect(value.evidence_backed_count).toBe(0);
    expect(value.golden_count).toBe(0);
  });

  it("rejects an unknown source through exact coverage admission", () => {
    const plan = YAML.parse(
      readFileSync(
        new URL(
          "../../../scenarios/scenario-coverage-plan.v0.3.yaml",
          import.meta.url,
        ),
        "utf8",
      ),
    ) as Record<string, unknown>;
    const scenarios = plan.scenarios as Array<Record<string, unknown>>;
    const first = scenarios[0];
    expect(first).toBeDefined();
    if (!first) return;
    first.primary_source_ids = [
      ...(first.primary_source_ids as string[]),
      "unknown.hostile.source",
    ];
    const registry = YAML.parse(
      readFileSync(
        new URL("../../../registry/trusted-sources.v0.3.yaml", import.meta.url),
        "utf8",
      ),
    ) as unknown;
    expect(() => validateTrustedSourceIds(plan, registry)).toThrowError(
      expect.objectContaining({ code: "plan_admission_failed" }),
    );
  });

  it("uses stable error codes for unreadable paths", () => {
    try {
      runCli({ cwd: root, plan_path: "missing/m7-plan.yaml" });
      throw new Error("expected failure");
    } catch (error) {
      expect(error).toBeInstanceOf(ChallengeTrackCliError);
      expect((error as ChallengeTrackCliError).code).toBe("input_read_failed");
    }
  });

  it("rejects duplicate registry IDs", () => {
    const registry = {
      registry_version: "0.3.0",
      sources: [{ id: "jp.example" }, { id: "jp.example" }],
    };
    expect(() =>
      buildChallengeTrackCliAudit({ plan: {}, registry }),
    ).toThrowError(
      expect.objectContaining({ code: "duplicate_registry_source" }),
    );
  });

  it("rejects hostile registry representations before dereference", () => {
    const plan = YAML.parse(
      readFileSync(
        new URL(
          "../../../scenarios/scenario-coverage-plan.v0.3.yaml",
          import.meta.url,
        ),
        "utf8",
      ),
    ) as unknown;
    const registry = YAML.parse(
      readFileSync(
        new URL("../../../registry/trusted-sources.v0.3.yaml", import.meta.url),
        "utf8",
      ),
    ) as Record<string, unknown>;

    expect(() =>
      validateTrustedSourceIds(plan, new Proxy(registry, {})),
    ).toThrowError(expect.objectContaining({ code: "invalid_registry" }));

    let getterCalls = 0;
    const accessor = {
      registry_version: registry.registry_version,
      get sources() {
        getterCalls += 1;
        return registry.sources;
      },
    };
    expect(() => validateTrustedSourceIds(plan, accessor)).toThrowError(
      expect.objectContaining({ code: "invalid_registry" }),
    );
    expect(getterCalls).toBe(0);

    const hidden = structuredClone(registry);
    Object.defineProperty(hidden, "hidden", {
      enumerable: false,
      value: "Bearer hidden",
    });
    expect(() => validateTrustedSourceIds(plan, hidden)).toThrowError(
      expect.objectContaining({ code: "invalid_registry" }),
    );
  });
});
