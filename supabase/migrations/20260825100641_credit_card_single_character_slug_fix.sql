-- Staged from db/0038_credit_card_single_character_slug_fix.sql; edit the canonical source, not this file.
-- Canonical card IDs may have a one-character product slug (instrument.card.d).
-- Relax only the direct card publisher's ID-shape check from one-plus-one to
-- one-plus-zero trailing characters.

begin;

do $fix$
declare
  v_oid oid;
  v_definition text;
begin
  select p.oid into v_oid
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'app_private'
     and p.proname = 'publish_credit_card_base_rule'
     and pg_get_function_identity_arguments(p.oid) =
       'p_card_id text, p_finding_id text, p_source_url text, p_source_title text, p_claims jsonb, p_annual_fee_jpy integer, p_base_reward_rate_percent numeric, p_effective_from timestamp with time zone, p_checked_at timestamp with time zone, p_evidence_locator jsonb, p_excerpt text, p_user_conditions jsonb, p_metadata jsonb';
  if v_oid is null then
    raise exception 'credit card publisher function not found';
  end if;
  v_definition := pg_get_functiondef(v_oid);
  v_definition := replace(
    v_definition,
    '^instrument[.]card[.][a-z0-9][a-z0-9._-]+$',
    '^instrument[.]card[.][a-z0-9][a-z0-9._-]*$'
  );
  execute v_definition;
end
$fix$;

commit;
