# Source registry v0.3

Canonical files:

- `trusted-sources.v0.3.yaml` and semantically identical JSON;
- `source-access-observations.v0.3.yaml` for dated, environment-specific observations;
- `source-review-queue.v0.3.yaml` for permission/storage/access review;
- `source-maintenance-pilot.v0.3.yaml` for the eight-source rehearsal;
- onboarding and observation templates.

A source separates:

1. claim-specific authority;
2. collection/storage/redistribution permission;
3. technical observations and a derived current classification;
4. URL registration from content verification.

Conflicting observations are valid data. `jp.viewcard.suica-charge` deliberately retains a manual-browser 200 and a datacenter 403, so its current classification is `environment_dependent_or_mixed`.

A successful response does not grant permission. A blocked response does not authorize bypass or a different collection method.
