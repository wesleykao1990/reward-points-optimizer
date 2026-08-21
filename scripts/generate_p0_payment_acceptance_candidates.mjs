import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  mapFindingToObservation,
  normalizeRunBundle,
} from "../packages/agent-feed-consumer/dist/index.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const basePath = path.join(
  root,
  "fixtures/m3/provisional/jp-cvs-002-credit-card-candidate.v0.1.json",
);
const bundlePath = path.join(
  root,
  "fixtures/m3/agent-feed/p0-seveneleven-payment-families.run-bundle.v0.1.json",
);
const outputPath = path.join(
  root,
  "fixtures/m3/provisional/p0-seveneleven-payment-family-candidates.v0.1.json",
);

const families = [
  ["barcode_payment", "バーコード決済"],
  ["brand_debit_card", "ブランドデビット"],
  ["brand_prepaid_card", "ブランドプリペイド"],
  ["credit_card", "クレジットカード"],
  ["gift_certificate", "共通商品券"],
  ["id", "iD"],
  ["nanaco", "nanaco"],
  ["quo_card", "QUOカード"],
  ["quicpay", "QUICPay"],
  ["rakuten_edy", "楽天Edy"],
  ["transport_e_money", "交通系電子マネー"],
];

const base = JSON.parse(await fs.readFile(basePath, "utf8"));
const bundle = JSON.parse(await fs.readFile(bundlePath, "utf8"));
const normalized = await normalizeRunBundle(bundle, {
  imported_at: "2026-08-21T04:51:00Z",
});
const delivery = normalized.deliveries.find(
  (item) => item.event.event_type === "finding.submitted",
);
if (!delivery) throw new Error("payment-family finding delivery missing");
const mapped = mapFindingToObservation({
  event: delivery.event,
  finding: delivery.event.payload.finding,
  submitted_evidence: delivery.event.payload.submitted_evidence,
  received_at: "2026-08-21T04:51:00Z",
});
if (!mapped) throw new Error("payment-family finding mapping rejected");

const candidates = families.map(([family, displayName]) => {
  const candidate = structuredClone(base);
  candidate.candidate_id = `candidate_p0_seveneleven_${family}_20260821_v0_1`;
  candidate.observation_id = mapped.observation.observation_id;
  candidate.observation_fingerprint = mapped.observation.semantic_fingerprint;
  candidate.rule.rule_id = `rr_p0_seveneleven_accept_${family}`;
  candidate.rule.name = `Seven-Eleven ${displayName} acceptance`;
  candidate.rule.description = `Acceptance-only provisional candidate for the evidenced ${displayName} payment family.`;
  candidate.rule.eligibility.operation_match.allowed_payment_instrument_ids = [
    `instrument.seveneleven.${family}`,
  ];
  candidate.rule.effect.reason_code = `accepted_payment_family_${family}`;
  candidate.rule.validity.valid_from = "2026-08-21T13:49:24+09:00";
  candidate.rule.validity.recorded_at = "2026-08-21T13:52:00+09:00";
  candidate.rule.provenance.evidence_ids = [
    "ev_p0_seveneleven_payment_methods_20260821",
  ];
  candidate.rule.provenance.review_notes =
    "The first-party payment-methods page was checked in a bounded manual source run. This provisional rule carries no reward calculation.";
  candidate.rule.audit.created_at = "2026-08-21T13:51:00+09:00";
  candidate.rule.audit.created_by = "p0-payment-family-extractor";
  candidate.rule.audit.change_reason =
    "Machine-extracted payment-acceptance candidate for correction-driven provisional publication.";
  candidate.extractor = {
    name: "p0-payment-family-extractor",
    version: "0.1",
  };
  candidate.machine_check = {
    ...candidate.machine_check,
    checker: "p0-payment-family-semantic-check",
    checker_version: "0.1",
    checked_at: "2026-08-21T04:52:00Z",
  };
  return { payment_family: family, display_name_ja: displayName, candidate };
});

await fs.writeFile(
  outputPath,
  `${JSON.stringify(
    {
      version: "p0-payment-acceptance-candidate-set.v0.1",
      source_run_bundle: path.relative(root, bundlePath),
      source_snapshot: mapped.observation.raw_attributes.source_snapshot_id,
      candidates,
    },
    null,
    2,
  )}\n`,
  "utf8",
);
