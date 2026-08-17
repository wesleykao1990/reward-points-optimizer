# Security, Privacy, and Compliance Boundaries v0.3

This is an engineering checklist, not legal advice.

## 1. Prohibited data

Do not collect or store:

- full card PAN;
- CVV/CVC;
- card or bank PIN;
- bank passwords or copied sessions;
- dynamic payment QR credentials;
- unencrypted screenshots containing dynamic payment credentials;
- issuer tokens outside an approved integration.

## 2. Restricted data

Restricted data includes:

- static loyalty barcode payloads;
- optional last four card digits;
- wallet composition;
- transaction and location history;
- user facts, tiers, campaign targeting, and cap progress;
- stored-value and point lots with expiry;
- receipts and correction evidence;
- financial aggregation tokens.

Restricted data needs minimization, encryption, access control, retention, deletion, and audit.

## 3. Database exposure

The reference SQL separates:

- `app_private`: evidence, rules, review, and benchmark replay;
- `app_api`: controlled views/functions;
- `user_data`: user-owned state with RLS enabled and forced.

Internal tables should not be exposed through the client Data API. RLS is not a substitute for private schema boundaries.

No permissive client policies are installed by default. Deployment-specific policies must be tested for owner isolation and service-role use.

## 4. Retention and deletion

Permanent replay is limited to synthetic fixtures, golden benchmarks, and separately approved redacted incidents.

User recommendation history requires:

- user reference;
- redacted payload;
- retention class;
- `purge_after` unless under a documented legal hold;
- deletion that covers derived history, correction reports, analytics identifiers, and encryption keys where applicable.

## 5. Immutability and audit

Source snapshots and review decisions are append-only. Approved rule definitions cannot be mutated; only their system-validity end may be closed through a controlled transition.

Auditability does not justify retaining raw personal data forever.

## 6. Static loyalty wallet

Static barcodes are locally encrypted by default, protected by platform secure storage and optional biometrics. Dynamic loyalty credentials and all payment QR values deep-link to the official app instead of being copied.

## 7. Source collection

Authority, terms permission, and technical reachability are independent. Before collection, review terms, robots guidance, license, request rate, storage, excerpt reuse, attribution, and redistribution.

A WAF or blocked response must not be bypassed. Use manual capture, permission, an official feed, a partner arrangement, or narrower coverage.

## 8. Financial-services boundary

The first product advises; it does not initiate payments, transfer funds, or collect bank credentials. Partner aggregation requires a separate provider contract, legal role assessment, consent/revocation flow, token design, retention plan, and incident process.

## 9. Commercial ranking

Organic rank is independent from compensation. Affiliate or sponsored placement is separately labeled and cannot modify the canonical winner.

## 10. Threat priorities

- false reward extraction causing financial loss;
- compromised reviewer publishing a false rule;
- prompt injection in source content;
- stale campaign remaining active;
- residual asset or charge reward double counting;
- unknown state represented as favorable fact;
- lottery represented as guaranteed value;
- logs leaking wallet, barcode, location, or transaction data;
- merchant alias or branch spoofing;
- affiliate manipulation.

## 11. Launch gate

- threat model and data inventory reviewed;
- prohibited-field tests pass;
- RLS, privilege, deletion, and retention tests pass;
- source permissions and technical paths recorded;
- incident owner and rollback procedure named;
- privacy and commercial disclosures reviewed;
- external security testing appropriate to actual launch scope completed.
