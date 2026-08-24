-- Universal, database-native Agent Feed rule materialization.
--
-- This lane is deliberately separate from the canonical publication and
-- provisional-rule tables.  Every normalized SourceObservation and every
-- implementation fact gets one immutable typed outcome, including
-- informational/incomplete rows.  Recommendation-time merchant acceptance is
-- read from the Rewards-owned relation below; this migration does not make a
-- request-time evidence or approval decision.

begin;

create table app_private.agent_feed_typed_rule_records (
    record_id uuid primary key default gen_random_uuid(),
    rule_id text not null,
    rule_version integer not null,
    source_kind text not null check (source_kind in ('source_observation','implementation_fact')),
    source_id uuid not null,
    source_identity jsonb not null,
    family_id text not null,
    source_role_id text not null,
    rule_class text not null check (rule_class in (
        'arithmetic_reward',
        'eligibility_constraint',
        'cap_minimum_rounding',
        'campaign_modifier',
        'transfer_conversion',
        'lifecycle',
        'inactive_history',
        'informational',
        'missing_parameters'
    )),
    calculable boolean not null,
    merchant_id text,
    payment_family text,
    subjects jsonb not null,
    raw_attributes jsonb not null,
    applicability jsonb not null default '{}'::jsonb,
    payload_hash text not null,
    observed_at timestamptz not null,
    created_at timestamptz not null default now(),
    check (rule_id ~ '^atr_[0-9a-f]{64}$'),
    check (rule_version > 0 and rule_version < 1000000),
    check (source_identity is not null and jsonb_typeof(source_identity) = 'object'),
    check (length(btrim(family_id)) between 1 and 128),
    check (family_id !~ '[[:cntrl:]]'),
    check (length(btrim(source_role_id)) between 1 and 128),
    check (source_role_id !~ '[[:cntrl:]]'),
    check (jsonb_typeof(subjects) = 'array'),
    check (jsonb_typeof(raw_attributes) = 'object'),
    check (jsonb_typeof(applicability) = 'object'),
    check (payload_hash ~ '^sha256:[0-9a-f]{64}$'),
    unique (rule_id, rule_version),
    unique (rule_id, payload_hash)
);

create index agent_feed_typed_rule_source_idx
    on app_private.agent_feed_typed_rule_records (source_kind, source_id, rule_version desc);
create index agent_feed_typed_rule_family_idx
    on app_private.agent_feed_typed_rule_records (family_id, observed_at desc, rule_version desc);

-- A separate append-only relation is the merchant-owned acceptance authority.
-- It is populated only when the normalized attributes contain explicit
-- merchant_id + payment family + boolean accepted fields.  No family or
-- acceptance value is inferred from prose, subjects, or evidence.
create table app_private.agent_feed_merchant_payment_acceptance (
    acceptance_id uuid primary key default gen_random_uuid(),
    record_id uuid not null
        references app_private.agent_feed_typed_rule_records(record_id)
        on delete restrict,
    merchant_id text not null,
    payment_family text not null,
    accepted boolean not null,
    rule_id text not null,
    rule_version integer not null,
    source_kind text not null check (source_kind in ('source_observation','implementation_fact')),
    source_id uuid not null,
    observed_at timestamptz not null,
    created_at timestamptz not null default now(),
    check (length(btrim(merchant_id)) between 1 and 128),
    check (merchant_id !~ '[[:cntrl:]]'),
    check (length(btrim(payment_family)) between 1 and 128),
    check (payment_family !~ '[[:cntrl:]]'),
    check (rule_id ~ '^atr_[0-9a-f]{64}$'),
    check (rule_version > 0 and rule_version < 1000000),
    unique (record_id, merchant_id, payment_family)
);

create index agent_feed_merchant_payment_acceptance_lookup_idx
    on app_private.agent_feed_merchant_payment_acceptance
       (merchant_id, payment_family, observed_at desc, rule_version desc);

create or replace function app_private.protect_agent_feed_typed_rule_append_only()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $$
begin
    raise exception '% is append-only/immutable after insert', tg_table_name
        using errcode = '55000';
end;
$$;

create trigger agent_feed_typed_rule_records_append_only
before update or delete on app_private.agent_feed_typed_rule_records
for each row execute function app_private.protect_agent_feed_typed_rule_append_only();

create trigger agent_feed_typed_rule_records_no_truncate
before truncate on app_private.agent_feed_typed_rule_records
for each statement execute function app_private.protect_agent_feed_typed_rule_append_only();

create trigger agent_feed_merchant_payment_acceptance_append_only
before update or delete on app_private.agent_feed_merchant_payment_acceptance
for each row execute function app_private.protect_agent_feed_typed_rule_append_only();

create trigger agent_feed_merchant_payment_acceptance_no_truncate
before truncate on app_private.agent_feed_merchant_payment_acceptance
for each statement execute function app_private.protect_agent_feed_typed_rule_append_only();

create or replace function app_private.agent_feed_typed_rule_opaque_family(
    p_source_kind text,
    p_source_id uuid,
    p_semantic_identity jsonb
)
returns text
language sql
immutable
security definer
set search_path = pg_catalog
as $$
    select 'agent_feed.opaque.' || substr(
        encode(
            public.digest(
                convert_to(
                    jsonb_build_object(
                        'source_kind', p_source_kind,
                        'source_id', p_source_id,
                        'semantic_identity', coalesce(p_semantic_identity, '{}'::jsonb)
                    )::text,
                    'utf8'
                ),
                'sha256'
            ),
            'hex'
        ),
        1,
        48
    )
$$;

create or replace function app_private.agent_feed_typed_rule_safe_identity(
    p_value text,
    p_fallback text
)
returns text
language sql
immutable
security definer
set search_path = pg_catalog
as $$
    select case
        when p_value is not null
         and length(btrim(p_value)) between 1 and 128
         and p_value !~ '[[:cntrl:]]'
        then btrim(p_value)
        else p_fallback
    end
$$;

create or replace function app_private.agent_feed_typed_rule_class(
    p_declared text,
    p_change_type text
)
returns text
language sql
immutable
security definer
set search_path = pg_catalog
as $$
    select case
        when p_declared in (
            'arithmetic_reward','eligibility_constraint','cap_minimum_rounding',
            'campaign_modifier','transfer_conversion','lifecycle','inactive_history',
            'informational','missing_parameters'
        ) then p_declared
        when p_change_type = 'reward_rate' then 'arithmetic_reward'
        when p_change_type in ('eligibility','merchant_acceptance') then 'eligibility_constraint'
        when p_change_type = 'cap' then 'cap_minimum_rounding'
        when p_change_type = 'campaign' then 'campaign_modifier'
        when p_change_type = 'transfer' then 'transfer_conversion'
        when p_change_type in ('expiry','funding_route') then 'lifecycle'
        when p_change_type in ('announcement','unknown') then 'informational'
        else 'missing_parameters'
    end
$$;

create or replace function app_private.agent_feed_typed_rule_fact_class(
    p_claim_type text,
    p_reason text,
    p_disposition text,
    p_predicate text
)
returns text
language sql
immutable
security definer
set search_path = pg_catalog
as $$
    select case
        when p_reason in ('ended_or_future_inactive','superseded','corrected')
            then 'inactive_history'
        when p_claim_type in ('earn_rule','reward_rate','redemption_value')
            or p_predicate ilike '%reward%'
            or p_predicate ilike '%point%rate%'
            then case when p_reason in ('insufficient_operation_mapping','unsupported_calculation_model',
                                        'non_calculable_fact','explicit_no_rate')
                      then 'missing_parameters' else 'arithmetic_reward' end
        when p_claim_type in ('eligibility','eligibility_rule','merchant_acceptance')
            or p_predicate ilike '%eligib%'
            or p_predicate ilike '%accept%'
            then 'eligibility_constraint'
        when p_claim_type in ('cap','minimum','rounding','funding_limit')
            or p_predicate ilike '%cap%'
            or p_predicate ilike '%round%'
            or p_predicate ilike '%minimum%'
            then 'cap_minimum_rounding'
        when p_claim_type in ('campaign_rule','campaign_period','campaign_modifier')
            or p_predicate ilike '%campaign%'
            then 'campaign_modifier'
        when p_claim_type in ('transfer','transfer_rule','conversion','redemption_conversion')
            or p_predicate ilike '%transfer%'
            or p_predicate ilike '%convert%'
            then 'transfer_conversion'
        when p_claim_type in ('expiry_rule','lifecycle','change_notice','timing')
            or p_predicate ilike '%expire%'
            or p_predicate ilike '%transition%'
            then 'lifecycle'
        when p_disposition = 'engine_rule' then 'missing_parameters'
        when p_reason is not null then 'informational'
        else 'missing_parameters'
    end
$$;

create or replace function app_private.agent_feed_typed_rule_parse_timestamp(
    p_value text
)
returns timestamptz
language plpgsql
immutable
security definer
set search_path = pg_catalog
as $$
begin
    if p_value is null or length(btrim(p_value)) = 0 then
        return null;
    end if;
    return p_value::timestamptz;
exception when others then
    return null;
end;
$$;

-- One shared writer keeps source-observation and implementation-fact
-- materialization identical.  The trigger wrappers below provide the exact
-- source-specific identity and status inputs.
create or replace function app_private.materialize_agent_feed_typed_rule(
    p_source_kind text,
    p_source_id uuid,
    p_source_identity jsonb,
    p_family_id text,
    p_source_role_id text,
    p_rule_class text,
    p_calculable boolean,
    p_merchant_id text,
    p_payment_family text,
    p_subjects jsonb,
    p_raw_attributes jsonb,
    p_applicability jsonb,
    p_observed_at timestamptz
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
    v_source_identity jsonb := case
        when jsonb_typeof(p_source_identity) = 'object' then p_source_identity
        else '{}'::jsonb
    end;
    v_subjects jsonb := case
        when jsonb_typeof(p_subjects) = 'array' then p_subjects
        else '[]'::jsonb
    end;
    v_raw_attributes jsonb := case
        when jsonb_typeof(p_raw_attributes) = 'object' then p_raw_attributes
        else '{}'::jsonb
    end;
    v_applicability jsonb := case
        when jsonb_typeof(p_applicability) = 'object' then p_applicability
        else '{}'::jsonb
    end;
    v_fallback_family text;
    v_family_id text;
    v_source_role_id text;
    v_rule_class text;
    v_calculable boolean := coalesce(p_calculable, false);
    v_merchant_id text;
    v_payment_family text;
    v_rule_id text;
    v_payload jsonb;
    v_payload_hash text;
    v_rule_version integer;
    v_record_id uuid;
    v_accepted boolean;
    v_payment_item jsonb;
begin
    if p_source_kind not in ('source_observation','implementation_fact')
       or p_source_id is null then
        raise exception 'typed rule source identity is invalid' using errcode = '22023';
    end if;

    v_fallback_family := app_private.agent_feed_typed_rule_opaque_family(
        p_source_kind, p_source_id, v_source_identity
    );
    v_family_id := app_private.agent_feed_typed_rule_safe_identity(
        p_family_id, v_fallback_family
    );
    v_source_role_id := app_private.agent_feed_typed_rule_safe_identity(
        p_source_role_id,
        case when p_source_kind = 'implementation_fact'
             then 'implementation_fact' else 'agent_feed_observation' end
    );
    v_rule_class := app_private.agent_feed_typed_rule_class(
        p_rule_class, null
    );

    -- The boolean and a complete, explicitly supplied calculation object are
    -- both required.  No rate, unit, amount, or arithmetic operation is ever
    -- synthesized from a summary, subject, or arbitrary numeric attribute.
    if not (
        v_calculable
        and jsonb_typeof(v_raw_attributes->'calculation') = 'object'
        and jsonb_typeof(v_raw_attributes->'calculation'->'model') = 'string'
        and length(btrim(v_raw_attributes->'calculation'->>'model')) > 0
    ) then
        v_calculable := false;
    end if;

    v_merchant_id := app_private.agent_feed_typed_rule_safe_identity(
        case when jsonb_typeof(v_raw_attributes->'merchant_id') = 'string'
             then v_raw_attributes->>'merchant_id' end,
        null
    );
    v_payment_family := app_private.agent_feed_typed_rule_safe_identity(
        case
            when jsonb_typeof(v_raw_attributes->'payment_family') = 'string'
                then v_raw_attributes->>'payment_family'
            when jsonb_typeof(v_raw_attributes->'accepted_payment_family') = 'string'
                then v_raw_attributes->>'accepted_payment_family'
        end,
        null
    );

    v_payload := jsonb_build_object(
        'version', 'agent-feed-typed-rule.v1',
        'rule_id', 'pending',
        'source_kind', p_source_kind,
        'source_id', p_source_id,
        'source_identity', v_source_identity,
        'family_id', v_family_id,
        'source_role_id', v_source_role_id,
        'rule_class', v_rule_class,
        'calculable', v_calculable,
        'merchant_id', v_merchant_id,
        'payment_family', v_payment_family,
        'subjects', v_subjects,
        'raw_attributes', v_raw_attributes,
        'applicability', v_applicability,
        'observed_at', coalesce(p_observed_at, now())
    );
    v_rule_id := 'atr_' || encode(
        public.digest(
            convert_to(
                jsonb_build_object(
                    'source_kind', p_source_kind,
                    'source_identity', v_source_identity,
                    'family_id', v_family_id
                )::text,
                'utf8'
            ),
            'sha256'
        ),
        'hex'
    );
    v_payload := jsonb_set(v_payload, '{rule_id}', to_jsonb(v_rule_id), false);
    v_payload_hash := 'sha256:' || encode(
        public.digest(convert_to(v_payload::text, 'utf8'), 'sha256'),
        'hex'
    );

    -- Serialize version allocation for one semantic rule identity.  This
    -- keeps concurrent duplicate deliveries append-only without making the
    -- projection mutable or relying on a retry-side repair.
    perform pg_advisory_xact_lock(hashtextextended(v_rule_id, 0));
    select coalesce(max(record.rule_version), 0) + 1
      into v_rule_version
      from app_private.agent_feed_typed_rule_records as record
     where record.rule_id = v_rule_id;

    insert into app_private.agent_feed_typed_rule_records (
        rule_id, rule_version, source_kind, source_id, source_identity,
        family_id, source_role_id, rule_class, calculable, merchant_id,
        payment_family, subjects, raw_attributes, applicability, payload_hash,
        observed_at
    ) values (
        v_rule_id, v_rule_version, p_source_kind, p_source_id, v_source_identity,
        v_family_id, v_source_role_id, v_rule_class, v_calculable, v_merchant_id,
        v_payment_family, v_subjects, v_raw_attributes, v_applicability,
        v_payload_hash, coalesce(p_observed_at, now())
    )
    on conflict (rule_id, payload_hash) do nothing
    returning record_id into v_record_id;

    if v_record_id is null then
        select record.record_id, record.rule_version
          into v_record_id, v_rule_version
          from app_private.agent_feed_typed_rule_records as record
         where record.rule_id = v_rule_id
           and record.payload_hash = v_payload_hash;
    end if;

    -- Only an explicit boolean accepted field authorizes this relation.  A
    -- bare `accepted_payment_families` array is retained in the typed rule but
    -- cannot become merchant authority by inference.
    if jsonb_typeof(v_raw_attributes->'accepted') = 'boolean' then
        v_accepted := (v_raw_attributes->>'accepted')::boolean;
        if v_payment_family is not null and v_merchant_id is not null then
            insert into app_private.agent_feed_merchant_payment_acceptance (
                record_id, merchant_id, payment_family, accepted, rule_id,
                rule_version, source_kind, source_id, observed_at
            ) values (
                v_record_id, v_merchant_id, v_payment_family, v_accepted,
                v_rule_id, v_rule_version, p_source_kind, p_source_id,
                coalesce(p_observed_at, now())
            ) on conflict (record_id, merchant_id, payment_family) do nothing;
        elsif jsonb_typeof(v_raw_attributes->'accepted_payment_families') = 'array'
              and v_merchant_id is not null then
            for v_payment_item in
                select item.value
                  from jsonb_array_elements(v_raw_attributes->'accepted_payment_families') as item(value)
            loop
                if jsonb_typeof(v_payment_item) = 'string'
                   and app_private.agent_feed_typed_rule_safe_identity(
                       v_payment_item #>> '{}', null
                   ) is not null
                then
                    insert into app_private.agent_feed_merchant_payment_acceptance (
                        record_id, merchant_id, payment_family, accepted, rule_id,
                        rule_version, source_kind, source_id, observed_at
                    ) values (
                        v_record_id, v_merchant_id,
                        app_private.agent_feed_typed_rule_safe_identity(
                            v_payment_item #>> '{}', null
                        ),
                        v_accepted, v_rule_id, v_rule_version, p_source_kind,
                        p_source_id, coalesce(p_observed_at, now())
                    ) on conflict (record_id, merchant_id, payment_family) do nothing;
                end if;
            end loop;
        end if;
    end if;

    return v_record_id;
end;
$$;

create or replace function app_private.materialize_agent_feed_source_observation_typed_rule()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
    v_attributes jsonb := case
        when jsonb_typeof(new.raw_attributes) = 'object' then new.raw_attributes
        else '{}'::jsonb
    end;
    v_subjects jsonb := case
        when jsonb_typeof(new.subjects) = 'array' then new.subjects
        else '[]'::jsonb
    end;
    v_family_id text;
    v_subject jsonb;
    v_semantic_identity jsonb;
    v_calculable boolean := false;
begin
    -- Prefer an explicit family field.  A subject ID is used only for the
    -- existing normalized merchant/program subject contract; otherwise the
    -- shared writer creates a bounded opaque family identity.
    v_family_id := case
        when jsonb_typeof(v_attributes->'family_id') = 'string'
            then v_attributes->>'family_id'
        when jsonb_typeof(v_attributes->'p0_family_id') = 'string'
            then v_attributes->>'p0_family_id'
        when jsonb_typeof(v_attributes->'service_family_id') = 'string'
            then v_attributes->>'service_family_id'
        else null
    end;
    if v_family_id is null and jsonb_array_length(v_subjects) > 0 then
        v_subject := v_subjects->0;
        if jsonb_typeof(v_subject) = 'object'
           and jsonb_typeof(v_subject->'id') = 'string'
        then
            v_family_id := v_subject->>'id';
        end if;
    end if;

    if jsonb_typeof(v_attributes->'calculable') = 'boolean' then
        v_calculable := (v_attributes->>'calculable')::boolean;
    end if;
    v_semantic_identity := jsonb_build_object(
        'semantic_fingerprint_version', new.semantic_fingerprint_version,
        'semantic_fingerprint', new.semantic_fingerprint,
        'observation_key', new.observation_key,
        'family_id', v_family_id
    );
    perform app_private.materialize_agent_feed_typed_rule(
        'source_observation',
        new.id,
        v_semantic_identity,
        v_family_id,
        case when jsonb_typeof(v_attributes->'source_role_id') = 'string'
             then v_attributes->>'source_role_id' end,
        case when jsonb_typeof(v_attributes->'rule_class') = 'string'
             then app_private.agent_feed_typed_rule_class(
                 v_attributes->>'rule_class', new.change_type
             )
             else app_private.agent_feed_typed_rule_class(null, new.change_type) end,
        v_calculable,
        null,
        null,
        v_subjects,
        v_attributes,
        jsonb_build_object(
            'effective_from', to_jsonb(new.effective_from),
            'effective_to', to_jsonb(new.effective_to),
            'status', new.status,
            'trust_state', case when new.trust_state is null then 'untrusted' else new.trust_state end
        ),
        new.created_at
    );
    return new;
end;
$$;

create or replace function app_private.materialize_agent_feed_implementation_fact_typed_rule()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
    v_attributes jsonb := case
        when jsonb_typeof(new.fact_payload) = 'object' then new.fact_payload
        else '{}'::jsonb
    end;
    v_identity jsonb;
    v_subjects jsonb;
    v_calculable boolean := false;
begin
    if new.disposition = 'engine_rule'
       and jsonb_typeof(new.derived_rule_ids) = 'array'
       and jsonb_array_length(new.derived_rule_ids) > 0
    then
        v_calculable := true;
    end if;
    v_identity := jsonb_build_object(
        'implementation_hash', new.implementation_hash,
        'implementation_version', new.implementation_version,
        'parent_claim_id', new.parent_claim_id,
        'fact_version', new.fact_version
    );
    v_subjects := jsonb_build_array(jsonb_build_object(
        'type', 'implementation_fact',
        'id', new.parent_claim_id,
        'name', new.subject
    ));
    perform app_private.materialize_agent_feed_typed_rule(
        'implementation_fact',
        new.fact_id,
        v_identity,
        new.family_id,
        new.source_role_id,
        app_private.agent_feed_typed_rule_fact_class(
            new.claim_type, new.reason, new.disposition, new.predicate
        ),
        v_calculable,
        null,
        null,
        v_subjects,
        v_attributes,
        case when jsonb_typeof(new.applicability) = 'object'
             then new.applicability else '{}'::jsonb end,
        (select snapshot.as_of
           from app_private.p0_implementation_snapshots as snapshot
          where snapshot.snapshot_id = new.snapshot_id)
    );
    return new;
end;
$$;

create trigger source_observations_agent_feed_typed_rule_materialization
after insert or update on app_private.source_observations
for each row execute function app_private.materialize_agent_feed_source_observation_typed_rule();

create trigger p0_implementation_facts_agent_feed_typed_rule_materialization
after insert on app_private.p0_implementation_facts
for each row execute function app_private.materialize_agent_feed_implementation_fact_typed_rule();

-- Backfill is performed through the same shared writer as future inserts.  It
-- is idempotent on payload hash, so migration replay or a duplicate delivery
-- cannot create another version of an unchanged rule.
do $backfill$
declare
    v_observation record;
    v_fact record;
    v_attributes jsonb;
    v_subjects jsonb;
    v_family_id text;
    v_subject jsonb;
    v_identity jsonb;
    v_calculable boolean;
begin
    for v_observation in
        select observation.*
          from app_private.source_observations as observation
         order by observation.id
    loop
        v_attributes := case
            when jsonb_typeof(v_observation.raw_attributes) = 'object'
                then v_observation.raw_attributes else '{}'::jsonb end;
        v_subjects := case
            when jsonb_typeof(v_observation.subjects) = 'array'
                then v_observation.subjects else '[]'::jsonb end;
        v_family_id := case
            when jsonb_typeof(v_attributes->'family_id') = 'string'
                then v_attributes->>'family_id'
            when jsonb_typeof(v_attributes->'p0_family_id') = 'string'
                then v_attributes->>'p0_family_id'
            when jsonb_typeof(v_attributes->'service_family_id') = 'string'
                then v_attributes->>'service_family_id'
            else null end;
        if v_family_id is null and jsonb_array_length(v_subjects) > 0 then
            v_subject := v_subjects->0;
            if jsonb_typeof(v_subject) = 'object'
               and jsonb_typeof(v_subject->'id') = 'string'
            then
                v_family_id := v_subject->>'id';
            end if;
        end if;
        v_calculable := jsonb_typeof(v_attributes->'calculable') = 'boolean'
            and (v_attributes->>'calculable')::boolean;
        v_identity := jsonb_build_object(
            'semantic_fingerprint_version', v_observation.semantic_fingerprint_version,
            'semantic_fingerprint', v_observation.semantic_fingerprint,
            'observation_key', v_observation.observation_key,
            'family_id', v_family_id
        );
        perform app_private.materialize_agent_feed_typed_rule(
            'source_observation', v_observation.id, v_identity, v_family_id,
            case when jsonb_typeof(v_attributes->'source_role_id') = 'string'
                 then v_attributes->>'source_role_id' end,
            case when jsonb_typeof(v_attributes->'rule_class') = 'string'
                 then app_private.agent_feed_typed_rule_class(
                     v_attributes->>'rule_class', v_observation.change_type
                 )
                 else app_private.agent_feed_typed_rule_class(
                     null, v_observation.change_type
                 ) end,
            v_calculable, null, null, v_subjects, v_attributes,
            jsonb_build_object(
                'effective_from', to_jsonb(v_observation.effective_from),
                'effective_to', to_jsonb(v_observation.effective_to),
                'status', v_observation.status,
                'trust_state', case when v_observation.trust_state is null then 'untrusted' else v_observation.trust_state end
            ),
            v_observation.created_at
        );
    end loop;

    for v_fact in
        select fact.*
          from app_private.p0_implementation_facts as fact
         order by fact.fact_id
    loop
        v_attributes := case
            when jsonb_typeof(v_fact.fact_payload) = 'object'
                then v_fact.fact_payload else '{}'::jsonb end;
        v_identity := jsonb_build_object(
            'implementation_hash', v_fact.implementation_hash,
            'implementation_version', v_fact.implementation_version,
            'parent_claim_id', v_fact.parent_claim_id,
            'fact_version', v_fact.fact_version
        );
        v_subjects := jsonb_build_array(jsonb_build_object(
            'type', 'implementation_fact',
            'id', v_fact.parent_claim_id,
            'name', v_fact.subject
        ));
        v_calculable := v_fact.disposition = 'engine_rule'
            and jsonb_typeof(v_fact.derived_rule_ids) = 'array'
            and jsonb_array_length(v_fact.derived_rule_ids) > 0;
        perform app_private.materialize_agent_feed_typed_rule(
            'implementation_fact', v_fact.fact_id, v_identity, v_fact.family_id,
            v_fact.source_role_id,
            app_private.agent_feed_typed_rule_fact_class(
                v_fact.claim_type, v_fact.reason, v_fact.disposition, v_fact.predicate
            ),
            v_calculable, null, null, v_subjects, v_attributes,
            case when jsonb_typeof(v_fact.applicability) = 'object'
                 then v_fact.applicability else '{}'::jsonb end,
            (select snapshot.as_of
               from app_private.p0_implementation_snapshots as snapshot
              where snapshot.snapshot_id = v_fact.snapshot_id)
        );
    end loop;
end;
$backfill$;

-- The route compiler needs the complete latest research snapshot so it can
-- apply each edge/campaign validity window itself. Filtering sibling facts at
-- the SQL layer made an otherwise valid direct-purchase rule fail merely
-- because an unrelated transfer companion was inactive. Corrections and
-- superseded snapshots remain excluded here; applicability is preserved in
-- the returned document and enforced by the calculation compiler.
create or replace function app_private.p0_implementation_rule_facts_at(
    p_effective_at timestamptz
)
returns table (
    claim_id text,
    family_id text,
    source_role_id text,
    claim_type text,
    subject text,
    predicate text,
    source_ids jsonb,
    value jsonb,
    applicability jsonb,
    research_artifact_id text,
    implementation_version text,
    implementation_hash text,
    as_of timestamptz
)
language sql
stable
security definer
set search_path = pg_catalog
as $$
    with current_snapshot as (
        select distinct on (snapshot.research_artifact_id)
               snapshot.snapshot_id,
               snapshot.research_artifact_id,
               snapshot.implementation_version,
               snapshot.implementation_hash,
               snapshot.as_of
          from app_private.p0_implementation_snapshots as snapshot
         order by snapshot.research_artifact_id asc,
                  snapshot.as_of desc,
                  snapshot.created_at desc,
                  snapshot.snapshot_id desc
    )
    select distinct on (fact.parent_claim_id)
        fact.parent_claim_id,
        fact.family_id,
        fact.source_role_id,
        fact.claim_type,
        fact.subject,
        fact.predicate,
        fact.source_ids,
        fact.value,
        fact.applicability,
        current_snapshot.research_artifact_id,
        current_snapshot.implementation_version,
        current_snapshot.implementation_hash,
        current_snapshot.as_of
      from app_private.p0_implementation_facts as fact
      join current_snapshot
        on current_snapshot.snapshot_id = fact.snapshot_id
     where not exists (
         select 1
           from app_private.p0_implementation_fact_corrections as correction
          where correction.fact_id = fact.fact_id
            and correction.implementation_hash = fact.implementation_hash
            and correction.parent_claim_id = fact.parent_claim_id
            and correction.fact_version = fact.fact_version
     )
     order by fact.parent_claim_id asc, fact.fact_version desc
     limit 2049
$$;

comment on function app_private.p0_implementation_rule_facts_at(timestamptz) is
    'Complete latest uncorrected implementation snapshot for deterministic route compilation. Applicability is returned and enforced by the compiler, not pre-filtered per sibling fact.';

-- Active state is deliberately computed from the current source rows and
-- correction ledgers.  The typed table itself remains append-only history.
create or replace function app_private.agent_feed_typed_rule_records_at(
    p_effective_at timestamptz
)
returns table (
    record_id uuid,
    rule_id text,
    rule_version integer,
    source_kind text,
    source_id uuid,
    source_identity jsonb,
    family_id text,
    source_role_id text,
    rule_class text,
    calculable boolean,
    merchant_id text,
    payment_family text,
    subjects jsonb,
    raw_attributes jsonb,
    applicability jsonb,
    payload_hash text,
    observed_at timestamptz
)
language sql
stable
security definer
set search_path = pg_catalog
as $$
    with active_rows as (
        select distinct on (record.rule_id)
               record.record_id,
               record.rule_id,
               record.rule_version,
               record.source_kind,
               record.source_id,
               record.source_identity,
               record.family_id,
               record.source_role_id,
               record.rule_class,
               record.calculable,
               record.merchant_id,
               record.payment_family,
               record.subjects,
               record.raw_attributes,
               record.applicability,
               record.payload_hash,
               record.observed_at
          from app_private.agent_feed_typed_rule_records as record
         where (
         record.source_kind = 'source_observation'
         and exists (
             select 1
               from app_private.source_observations as observation
              where observation.id = record.source_id
                and observation.status not in ('rejected','closed')
                and coalesce(observation.trust_state, 'untrusted') <> 'quarantined'
                and coalesce(observation.security_flags, '[]'::jsonb) = '[]'::jsonb
                and (
                    p_effective_at is null
                    or observation.effective_from is null
                    or observation.effective_from <= p_effective_at
                )
                and (
                    p_effective_at is null
                    or observation.effective_to is null
                    or observation.effective_to > p_effective_at
                )
         )
         )
         or (
         record.source_kind = 'implementation_fact'
         and exists (
             select 1
               from app_private.p0_implementation_facts as fact
              where fact.fact_id = record.source_id
                and not exists (
                    select 1
                      from app_private.p0_implementation_fact_corrections as correction
                     where correction.fact_id = fact.fact_id
                       and correction.implementation_hash = fact.implementation_hash
                       and correction.parent_claim_id = fact.parent_claim_id
                       and correction.fact_version = fact.fact_version
                )
                and app_private.p0_implementation_window_active(
                    fact.claim_type,
                    fact.reason,
                    fact.applicability,
                    p_effective_at
                )
         )
         )
         order by record.rule_id, record.rule_version desc
    )
    select active.record_id,
           active.rule_id,
           active.rule_version,
           active.source_kind,
           active.source_id,
           active.source_identity,
           active.family_id,
           active.source_role_id,
           active.rule_class,
           active.calculable,
           active.merchant_id,
           active.payment_family,
           active.subjects,
           active.raw_attributes,
           active.applicability,
           active.payload_hash,
           active.observed_at
      from active_rows as active
     order by active.family_id, active.rule_id, active.rule_version
     limit 4097
$$;

create or replace function app_private.agent_feed_active_rule_families_at(
    p_effective_at timestamptz
)
returns table (
    family_id text,
    rule_count bigint,
    calculable_rule_count bigint,
    acceptance_count bigint
)
language sql
stable
security definer
set search_path = pg_catalog
as $$
    with active_rules as (
        select *
          from app_private.agent_feed_typed_rule_records_at(p_effective_at)
    ),
    acceptance as (
        select distinct on (authority.merchant_id, authority.payment_family)
               authority.merchant_id,
               authority.payment_family,
               authority.accepted
          from app_private.agent_feed_merchant_payment_acceptance as authority
          join active_rules as active
            on active.record_id = authority.record_id
         order by authority.merchant_id, authority.payment_family,
                  authority.observed_at desc, authority.rule_version desc,
                  authority.acceptance_id desc
    )
    select active.family_id,
           count(*)::bigint,
           count(*) filter (where active.calculable)::bigint,
           count(*) filter (
               where exists (
                   select 1 from acceptance
                    where acceptance.payment_family = active.family_id
                      and acceptance.accepted
               )
           )::bigint
      from active_rules as active
     group by active.family_id
     order by active.family_id
     limit 4097
$$;

create or replace function app_private.agent_feed_active_merchant_payment_acceptance_at(
    p_effective_at timestamptz
)
returns table (
    merchant_id text,
    payment_family text,
    accepted boolean,
    rule_id text,
    rule_version integer,
    source_kind text,
    source_id uuid,
    observed_at timestamptz
)
language sql
stable
security definer
set search_path = pg_catalog
as $$
    with active_rules as (
        select *
          from app_private.agent_feed_typed_rule_records_at(p_effective_at)
    ),
    current_authority as (
        select distinct on (authority.merchant_id, authority.payment_family)
               authority.merchant_id,
               authority.payment_family,
               authority.accepted,
               authority.rule_id,
               authority.rule_version,
               authority.source_kind,
               authority.source_id,
               authority.observed_at,
               authority.acceptance_id
          from app_private.agent_feed_merchant_payment_acceptance as authority
          join active_rules as active
            on active.source_id = authority.source_id
           and active.source_kind = authority.source_kind
           and active.rule_id = authority.rule_id
           and active.rule_version = authority.rule_version
         order by authority.merchant_id, authority.payment_family,
                  authority.observed_at desc, authority.rule_version desc,
                  authority.acceptance_id desc
    ),
    -- Existing and future active provisional payment-acceptance rules are
    -- already the Rewards merchant catalogue. Project their exact structured
    -- merchant scope and reason code directly, so recommendation reads do not
    -- require a second proof/evidence lookup and the current P0 seed is usable
    -- immediately. Unknown payment-family reason codes are omitted rather
    -- than guessed.
    candidate_authority as (
        select distinct on (merchant.value, payment.payment_family)
               merchant.value as merchant_id,
               payment.payment_family,
               true as accepted,
               'atr_' || substr(candidate.candidate_hash, 8) as rule_id,
               coalesce(
                   case when jsonb_typeof(candidate.candidate_payload #> '{rule,version}') = 'number'
                        then (candidate.candidate_payload #>> '{rule,version}')::integer end,
                   1
               ) as rule_version,
               'source_observation'::text as source_kind,
               candidate.source_observation_id as source_id,
               candidate.machine_checked_at as observed_at
          from app_api.active_experimental_provisional_rules_at(p_effective_at) as candidate
          cross join lateral jsonb_array_elements_text(
              candidate.candidate_payload #> '{rule,scope,merchant_ids}'
          ) as merchant(value)
          cross join lateral (
              select case candidate.candidate_payload #>> '{rule,effect,reason_code}'
                  when 'accepted_payment_family_credit_card' then 'category.credit_card'
                  when 'accepted_payment_family_barcode_payment' then 'category.mobile_pay'
                  when 'accepted_payment_family_nanaco' then 'emoney.nanaco'
                  when 'accepted_payment_family_rakuten_edy' then 'emoney.rakuten-edy'
                  when 'accepted_payment_family_id' then 'emoney.id'
                  when 'accepted_payment_family_quicpay' then 'emoney.quicpay'
                  when 'accepted_payment_family_transport_e_money' then 'emoney.transport'
                  else null
              end as payment_family
          ) as payment
         where candidate.candidate_payload #>> '{rule,rule_type}' = 'payment_acceptance'
           and candidate.candidate_payload #>> '{rule,effect,decision}' = 'allow'
           and payment.payment_family is not null
         order by merchant.value, payment.payment_family,
                  candidate.machine_checked_at desc, candidate.candidate_hash desc
    )
    select authority.merchant_id, authority.payment_family, authority.accepted,
           authority.rule_id, authority.rule_version, authority.source_kind,
           authority.source_id, authority.observed_at
      from (
          select merchant_id, payment_family, accepted, rule_id, rule_version,
                 source_kind, source_id, observed_at
            from current_authority
          union all
          select candidate.merchant_id, candidate.payment_family,
                 candidate.accepted, candidate.rule_id, candidate.rule_version,
                 candidate.source_kind, candidate.source_id,
                 candidate.observed_at
            from candidate_authority as candidate
           where not exists (
               select 1
                 from current_authority as direct
                where direct.merchant_id = candidate.merchant_id
                  and direct.payment_family = candidate.payment_family
           )
      ) as authority
     order by merchant_id, payment_family
     limit 4097
$$;

revoke all on app_private.agent_feed_typed_rule_records from public;
revoke all on app_private.agent_feed_merchant_payment_acceptance from public;
revoke all on function app_private.protect_agent_feed_typed_rule_append_only() from public;
revoke all on function app_private.agent_feed_typed_rule_opaque_family(text,uuid,jsonb) from public;
revoke all on function app_private.agent_feed_typed_rule_safe_identity(text,text) from public;
revoke all on function app_private.agent_feed_typed_rule_class(text,text) from public;
revoke all on function app_private.agent_feed_typed_rule_fact_class(text,text,text,text) from public;
revoke all on function app_private.agent_feed_typed_rule_parse_timestamp(text) from public;
revoke all on function app_private.materialize_agent_feed_typed_rule(text,uuid,jsonb,text,text,text,boolean,text,text,jsonb,jsonb,jsonb,timestamptz) from public;
revoke all on function app_private.materialize_agent_feed_source_observation_typed_rule() from public;
revoke all on function app_private.materialize_agent_feed_implementation_fact_typed_rule() from public;
revoke all on function app_private.agent_feed_typed_rule_records_at(timestamptz) from public;
revoke all on function app_private.agent_feed_active_rule_families_at(timestamptz) from public;
revoke all on function app_private.agent_feed_active_merchant_payment_acceptance_at(timestamptz) from public;

grant execute on function
    app_private.agent_feed_typed_rule_records_at(timestamptz),
    app_private.agent_feed_active_rule_families_at(timestamptz),
    app_private.agent_feed_active_merchant_payment_acceptance_at(timestamptz)
to jro_runtime;

comment on table app_private.agent_feed_typed_rule_records is
    'Append-only universal typed outcomes for normalized SourceObservations and implementation facts; inactive history remains queryable only through private maintenance access.';
comment on table app_private.agent_feed_merchant_payment_acceptance is
    'Rewards-owned merchant acceptance authority. Rows require explicit merchant_id, payment family, and boolean accepted attributes; no request-time evidence proof is performed.';
comment on function app_private.agent_feed_typed_rule_records_at(timestamptz) is
    'Bounded current typed-rule projection. Active status is derived from current SourceObservation trust/status and implementation-fact correction/window state.';
comment on function app_private.agent_feed_active_rule_families_at(timestamptz) is
    'Bounded enumerable active-family projection over all typed SourceObservation and implementation-fact outcomes.';
comment on function app_private.agent_feed_active_merchant_payment_acceptance_at(timestamptz) is
    'Bounded current merchant-payment authority. It reads explicit structured acceptance rows and does not consult evidence or approval state at recommendation time.';

commit;
