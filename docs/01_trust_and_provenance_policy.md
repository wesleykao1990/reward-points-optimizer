# Trust and Provenance Policy v0.3

## 1. Purpose

The optimizer may influence how a user spends money, consumes stored value, or converts points and miles. A recommendation is trustworthy only when the facts, calculations, uncertainty, and historical state are reproducible.

The canonical chain is:

```text
source registry entry
  -> access/permission decision
  -> immutable source snapshot
  -> atomic evidence record
  -> untrusted extraction candidate
  -> reviewed rule version
  -> deterministic purchase-plan evaluation
  -> native asset ledger and residual assets
  -> separate user valuation
  -> replayable result
```

No downstream object makes an upstream claim more authoritative.

## 2. Three separate source dimensions

### Authority

Authority is claim-specific. A merchant is authoritative for accepted tenders and branch exceptions; a card issuer is authoritative for card rewards and exclusions; a wallet provider is authoritative for funding and campaign rules; a regulator is authoritative for its regulatory guidance.

### Legal and contractual permission

Terms, copyright, licensing, robots policy, authentication, storage, quotation, attribution, and redistribution must be reviewed separately. Public availability is not automatic permission for scheduled collection or republication.

### Technical feasibility

A reachability observation records what happened from a dated environment and method. It is not permanent truth and it is not permission. A blocked response is never a signal to evade controls.

## 3. Source tiers

- `T0_REGULATOR`: law, regulator, or government guidance.
- `T1_CANONICAL`: first-party terms, program rules, issuer rules, merchant rules, or official technical documentation.
- `T2_OFFICIAL_SUPPORT`: first-party FAQ, directory, help page, campaign index, or explainer.
- `T3_PARTNER_CONTRACT`: a licensed feed or contractual API that has actually been obtained.
- `T4_DISCOVERY_ONLY`: a third-party signal used only to open a research ticket and locate primary evidence.

A T4 source can accelerate change detection but cannot publish a reward fact.

## 4. Verification states

`url_registered_on` means the source was added to the registry. It does not mean the content was read.

`content_verified_on` is populated only after a reviewer has confirmed that the page is live and authoritative for the listed scope. A blocked or unavailable source may remain registered while requiring manual capture or another permitted path.

## 5. Immutable evidence

A source snapshot records:

- requested and effective URL;
- acquisition method and policy version;
- capture time;
- raw and normalized hashes;
- permitted storage location;
- parser/renderer versions;
- completeness and metadata.

Snapshots are immutable after insert. Corrections create a new snapshot or evidence record.

Evidence is atomic. Each record supports one or more explicit JSON pointers in a rule or fixture and contains the smallest useful locator and excerpt permitted by policy.

## 6. Extraction is untrusted

An LLM or parser may propose:

- operation scope;
- eligibility conditions;
- reward class;
- calculation fields;
- validity dates;
- caps, posting, expiry, and clawback;
- uncertainties and conflicting passages.

It cannot publish, calculate a canonical winner, infer campaign entry, assume unknown cap progress is zero, or obey instructions embedded in source content.

The prompt-injection fixture in `examples/` is a required security contract: embedded instructions are quarantined and produce no candidate rule.

## 7. Review modes

- `solo_dual_pass`: independent worksheet first, engine output hidden, cooling-off period, raw evidence reread, and recorded checklist.
- `agent_challenged`: a separate model or deterministic auditor challenges the result; useful but not an accountable human reviewer.
- `human_second_review`: a different person reproduces evidence and arithmetic.
- `expert_review`: a qualified reviewer handles high-loss, legal, security, or specialist conversion cases.

The recorded mode must match reality. A solo review is never labeled two-person or independently human-verified.

## 8. Risk-based publication

Actual second-person or expert review should be reserved for rules that can materially cause loss, including:

- large or irreversible point/mile transfers;
- campaigns requiring significant purchase commitments;
- annual-fee or welcome-offer card rankings;
- material funding-source exclusions;
- rules affecting a large user population;
- legal, privacy, security, or advertising decisions.

Lower-risk public rules may use a documented solo dual-pass process during the early product stage.

## 9. Bitemporal truth

Every approved rule records:

- **economic validity**: when it actually applied;
- **system validity**: when the optimizer knew and retained that version.

An announcement date is not an effective date. A postponed change remains an announcement and must not silently alter current recommendations.

## 10. Correction and rollback

Published definitions are not edited in place. A correction creates new evidence and a new rule version, closes the prior version's system validity, reruns impacted scenarios, and retains historical replay.
