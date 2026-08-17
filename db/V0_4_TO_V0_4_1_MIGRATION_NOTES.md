# v0.4 → v0.4.1 migration notes

The package has not launched, so the clean baseline migration is corrected directly. An existing v0.4 development database should:

1. drop `reward_rule_versions_rule_id_definition_hash_key`;
2. create a non-unique `(rule_id, definition_hash)` index;
3. add `rule_publication_requests` for idempotent publication commands;
4. add required/completed review-mode arrays and backfill approved rows before enabling checks;
5. apply Agent Feed receipt redaction, observation transition, liveness, source-freshness, and purge functions;
6. run all database regressions, especially definition-hash reuse and review requirements.

Do not mark the migration complete merely because SQL parses. Execute it against PostgreSQL 15+ and test the negative cases.
