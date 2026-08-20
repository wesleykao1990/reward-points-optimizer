# Codex handoff for accepted CoverageCandidate

Use this only after a Rewards-side coverage candidate reaches `accepted_for_research`.

## GitHub Issue template

```markdown
# CoverageCandidate research: <candidate name>

Candidate ID: <candidate_id>
Candidate type: <candidate_type>
Discovery stream: <stream_id>
Proposed priority: <P1/P2/P3 or hold>
Status: accepted_for_research

## Why this appears novel

<normalization / registry-resolution summary>

## Discovery evidence

- <URL / evidence reference>

Discovery evidence is untrusted planning input, not canonical economic truth.

## Possible existing matches checked

- Source family matches: <none / IDs>
- Product matches: <none / IDs>
- Alias/rebrand matches: <none / values>
- Known-domain matches: <none / values>

## Codex task

1. Load GitHub Issue #2 and `codex-context/source-coverage-v0.6`.
2. Research direct official operator/issuer/program sources.
3. Decide whether this candidate is:
   - a new child source for an existing family;
   - an alias/rebrand;
   - a new selectable product under an existing family;
   - a genuinely new source family;
   - invalid/dead/irrelevant.
4. Identify all required source roles if a family/product should be onboarded.
5. Do not invent economic rules or use discovery media as canonical evidence.
6. If a `main` change is justified, create a focused branch/PR, update tests, and regenerate package checksums using the repository tooling.
7. Report unresolved evidence/permission/access gaps explicitly.

## Acceptance criteria

- Official identity/source is established or candidate is rejected/deferred.
- Existing registry/product duplicates are ruled out.
- Proposed IDs and mappings follow repository conventions.
- No finding directly creates a RewardRuleVersion.
- Any main-package modification passes package integrity and existing tests.
```

## Automation boundary

The Rewards service may create this issue automatically after policy/human triage, but it should not auto-assign Codex until candidate volume and precision are acceptable.

Start with manual assignment. Later, high-quality candidate classes can trigger an automated Codex task while retaining PR review.

## Recommended Codex output

Codex should return one of:

```text
EXISTING_FAMILY_CHILD_SOURCE
ALIAS_OR_REBRAND
NEW_SELECTABLE_PRODUCT
NEW_SOURCE_FAMILY_PROPOSAL
DEFER_INSUFFICIENT_OFFICIAL_EVIDENCE
REJECT_NOT_RELEVANT_OR_INACTIVE
```

and include direct official evidence, proposed registry/catalogue diff, tests, and any remaining uncertainty.
