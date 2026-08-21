import { createHash } from "node:crypto";

export interface GenericFindingEvent {
  protocolVersion: string;
  eventId: string;
  streamId: string;
  runId: string;
  findingId: string | null;
  payload: {
    finding?: {
      findingId: string;
      findingType: string;
      title: string;
      summary: string;
      subjects: unknown[];
      evidenceRefs: string[];
      securityFlags: string[];
      attributes: Record<string, unknown>;
    };
  };
}

function hash(value: unknown): string {
  return `sha256:${createHash("sha256").update(JSON.stringify(value)).digest("hex")}`;
}

export function mapFindingToObservation(event: GenericFindingEvent) {
  if (event.protocolVersion !== "0.1") throw new Error("unsupported_protocol");
  const finding = event.payload.finding;
  if (!finding) throw new Error("missing_finding");
  const hostile = finding.securityFlags.some(
    (flag) =>
      flag === "embedded_instruction" ||
      flag === "attempted_authority_escalation",
  );
  return {
    observationId: `so_${finding.findingId.replace(/[^a-z0-9_-]/gi, "_").toLowerCase()}`,
    agentFeed: {
      protocolVersion: "0.1",
      eventId: event.eventId,
      streamId: event.streamId,
      runId: event.runId,
      findingId: finding.findingId,
    },
    subjects: finding.subjects,
    summary: finding.summary,
    submittedEvidenceRefs: finding.evidenceRefs,
    canonicalEvidenceIds: [],
    semanticFingerprintVersion: 1,
    semanticFingerprint: hash({
      type: finding.findingType,
      subjects: finding.subjects,
      summary: finding.summary,
    }),
    status: hostile ? "rejected" : "needs_evidence",
    securityFlags: finding.securityFlags,
    rawAttributes: finding.attributes,
  };
}
