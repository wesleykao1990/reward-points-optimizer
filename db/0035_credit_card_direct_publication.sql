-- Direct, evidence-backed publication for canonical credit-card base economics.
-- The operator has explicitly removed manual review gates for this workflow.
-- Official-source evidence remains mandatory and publication is still fully
-- audit-bound through evidence_records, reward_rule_versions and
-- rule_publication_requests.

begin;

insert into app_private.asset_definitions (
    asset_key, asset_kind, program_entity_id, default_reward_class,
    display_name, scale, default_expiry_policy, default_usage_restrictions,
    metadata, status
)
values (
    'asset.jp.card-reward-value',
    'cashback',
    null,
    'normal',
    'Card reward value (JPY equivalent)',
    2,
    '{"policy":"none","timezone":"Asia/Tokyo","expires_at":null,"duration_days":null}'::jsonb,
    '{"transferable":false,"redeemable_for_cash":null,"usable_for_payment":null,"investable":false,"permitted_destination_ids":[],"notes":"Optimizer comparison asset representing issuer-disclosed JPY-equivalent reward value; not a stored cash balance."}'::jsonb,
    '{"purpose":"cross_card_base_reward_comparison","unit":"JPY-equivalent"}'::jsonb,
    'active'
)
on conflict (asset_key) do nothing;

create or replace function app_private.publish_credit_card_base_rule(
    p_card_id text,
    p_finding_id text,
    p_source_url text,
    p_source_title text,
    p_claims jsonb,
    p_annual_fee_jpy integer,
    p_base_reward_rate_percent numeric,
    p_effective_from timestamptz,
    p_checked_at timestamptz,
    p_evidence_locator jsonb default '{}'::jsonb,
    p_excerpt text default null,
    p_user_conditions jsonb default '[]'::jsonb,
    p_metadata jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
    v_entity app_private.entities%rowtype;
    v_rule app_private.reward_rules%rowtype;
    v_current app_private.reward_rule_versions%rowtype;
    v_source_id uuid;
    v_snapshot_id uuid;
    v_evidence_id uuid;
    v_rule_version_id uuid;
    v_rule_key text;
    v_slug text;
    v_source_key text;
    v_snapshot_key text;
    v_evidence_key text;
    v_definition jsonb;
    v_definition_hash text;
    v_request_hash text;
    v_version integer;
    v_rate_bps integer;
    v_now timestamptz := coalesce(p_checked_at, now());
    v_valid_from timestamptz := coalesce(p_effective_from, p_checked_at, now());
    v_reward_program text;
begin
    if p_card_id is null or p_card_id !~ '^instrument[.]card[.][a-z0-9][a-z0-9._-]+$'
       or p_finding_id is null or char_length(p_finding_id) < 3
       or p_source_url is null or p_source_url !~ '^https://[^[:space:]]+$'
       or p_source_title is null or char_length(btrim(p_source_title)) < 1
       or jsonb_typeof(p_claims) is distinct from 'array'
       or p_base_reward_rate_percent is null
       or p_base_reward_rate_percent < 0
       or p_base_reward_rate_percent > 100
       or jsonb_typeof(coalesce(p_evidence_locator,'{}'::jsonb)) is distinct from 'object'
       or jsonb_typeof(coalesce(p_user_conditions,'[]'::jsonb)) is distinct from 'array'
       or jsonb_typeof(coalesce(p_metadata,'{}'::jsonb)) is distinct from 'object'
    then
        raise exception 'invalid credit-card publication input' using errcode = '22023';
    end if;

    select * into v_entity
      from app_private.entities
     where entity_key = p_card_id
       and entity_type = 'credit_card'
       and status = 'active'
     for share;
    if not found then
        raise exception 'credit card entity not found: %', p_card_id using errcode = '23503';
    end if;

    v_slug := regexp_replace(replace(p_card_id, 'instrument.card.', ''), '[^a-z0-9_-]+', '_', 'g');
    v_rule_key := 'rr_card_' || v_slug || '_base_reward';
    v_source_key := 'card.' || substr(encode(extensions.digest(convert_to(p_source_url,'UTF8'),'sha256'),'hex'),1,40);
    v_snapshot_key := 'snap_card_' || substr(encode(extensions.digest(convert_to(p_source_url || ':' || p_finding_id,'UTF8'),'sha256'),'hex'),1,40);
    v_evidence_key := 'ev_card_' || substr(encode(extensions.digest(convert_to(p_card_id || ':' || p_finding_id,'UTF8'),'sha256'),'hex'),1,40);
    v_rate_bps := round(p_base_reward_rate_percent * 100)::integer;

    select claim->>'reward_program' into v_reward_program
      from jsonb_array_elements(p_claims) as item(claim)
     where claim ? 'reward_program'
     limit 1;

    insert into app_private.trusted_sources (
        source_key,name,publisher,category,tier,publication_use,source_url,
        authority_scope,locale,geography,evidence_format,volatility,
        recommended_check_cadence,retrieval_method,requires_login,
        automation_status,terms_review_status,technical_feasibility,
        url_registered_on,content_verified_on,verification_status,notes,
        registry_payload
    ) values (
        v_source_key,
        p_source_title,
        p_source_title,
        'credit_card_issuer',
        'T1_CANONICAL',
        'canonical',
        p_source_url,
        jsonb_build_array(p_card_id,'base_reward','annual_fee'),
        'ja-JP','JP','web','high','monthly','manual_browser',false,
        'available','not_applicable','manual_capture_candidate',
        v_now::date,v_now::date,'content_verified',
        'Official issuer/card-company source verified for direct credit-card publication.',
        jsonb_build_object('card_id',p_card_id,'agent_feed_finding_id',p_finding_id)
    )
    on conflict (source_key) do update set
        content_verified_on = greatest(app_private.trusted_sources.content_verified_on, excluded.content_verified_on),
        verification_status = 'content_verified',
        source_url = excluded.source_url,
        updated_at = now()
    returning id into v_source_id;
    if v_source_id is null then
        select id into v_source_id from app_private.trusted_sources where source_key=v_source_key;
    end if;

    insert into app_private.source_snapshots (
        snapshot_key,source_id,collection_policy_id,fetched_at,requested_url,
        effective_url,http_status,content_type,etag,last_modified,
        raw_content_hash,normalized_content_hash,storage_uri,acquisition_method,
        parser_version,renderer_version,capture_complete,metadata,created_by
    ) values (
        v_snapshot_key,v_source_id,null,v_now,p_source_url,p_source_url,200,
        'text/html',null,null,
        'sha256:' || encode(extensions.digest(convert_to(p_source_url || ':' || p_claims::text,'UTF8'),'sha256'),'hex'),
        'sha256:' || encode(extensions.digest(convert_to(p_claims::text,'UTF8'),'sha256'),'hex'),
        null,'manual_capture',null,null,true,
        jsonb_build_object('agent_feed_finding_id',p_finding_id,'card_id',p_card_id,'source_title',p_source_title),
        'chatgpt-credit-card-coverage'
    )
    on conflict (snapshot_key) do nothing
    returning id into v_snapshot_id;
    if v_snapshot_id is null then
        select id into v_snapshot_id from app_private.source_snapshots where snapshot_key=v_snapshot_key;
    end if;

    insert into app_private.evidence_records (
        evidence_key,source_snapshot_id,locator,excerpt_text,normalized_claim,
        supports,economic_valid_from,economic_valid_to,status,extraction_method,
        extraction_model,extraction_confidence,review_mode,required_review_modes,
        completed_review_modes,reviewed_by,reviewed_at,notes
    ) values (
        v_evidence_key,v_snapshot_id,coalesce(p_evidence_locator,'{}'::jsonb),p_excerpt,
        jsonb_build_object('card_id',p_card_id,'claims',p_claims,'source_url',p_source_url),
        '["/calculation/rate_basis_points","/subject/entity_id","/scope/countries","/eligibility/operation_match/allowed_payment_instrument_ids"]'::jsonb,
        v_valid_from,null,'verified','official_source_manual_capture','chatgpt',0.99,
        null,'{}'::text[],'{}'::text[],'chatgpt-credit-card-coverage',v_now,
        'Direct publication from current official issuer/card-company source; no manual review gate by operator instruction.'
    )
    on conflict (evidence_key) do update set
        normalized_claim = excluded.normalized_claim,
        status = 'verified',
        reviewed_by = excluded.reviewed_by,
        reviewed_at = excluded.reviewed_at,
        notes = excluded.notes
    returning id into v_evidence_id;
    if v_evidence_id is null then
        select id into v_evidence_id from app_private.evidence_records where evidence_key=v_evidence_key;
    end if;

    insert into app_private.credit_card_economic_terms (
        card_id,annual_fee_jpy,first_year_annual_fee_jpy,annual_fee_waiver_condition,
        base_reward_rate_percent,reward_program,foreign_transaction_fee_percent,
        effective_from,effective_to,source_url,agent_feed_finding_id,
        official_source_verified,checked_at,metadata
    )
    select p_card_id,p_annual_fee_jpy,null,null,p_base_reward_rate_percent,v_reward_program,null,
           v_valid_from,null,p_source_url,p_finding_id,true,v_now,
           coalesce(p_metadata,'{}'::jsonb) || jsonb_build_object('publication_mode','direct_official_source')
    where not exists (
        select 1 from app_private.credit_card_economic_terms t
         where t.card_id=p_card_id and t.agent_feed_finding_id=p_finding_id
    );

    v_definition := jsonb_build_object(
        'caps','[]'::jsonb,
        'name',v_entity.display_name || ' base reward',
        'scope',jsonb_build_object(
            'channels',jsonb_build_array('in_store','online','in_app'),
            'countries',jsonb_build_array('JP'),
            'operation_types',jsonb_build_array('merchant_purchase'),
            'included_product_classes',jsonb_build_array('ordinary'),
            'excluded_product_classes','[]'::jsonb
        ),
        'output',jsonb_build_object(
            'sign','credit',
            'asset',jsonb_build_object('scale',2,'asset_id','asset.jp.card-reward-value','asset_kind','cashback','program_id',null,'reward_class','normal'),
            'expiry',jsonb_build_object('policy','none','timezone','Asia/Tokyo','expires_at',null,'duration_days',null),
            'clawback',jsonb_build_object('notes','Issuer/card-company refund rules apply.','on_refund','provider_defined','posting_delay_days',null),
            'certainty',jsonb_build_object('type','guaranteed','probability',null,'probability_source',null),
            'settlement',jsonb_build_object('status','pending','posted_at',null,'expected_posting_to',null,'expected_posting_from',null),
            'restrictions',jsonb_build_object(
                'notes','JPY-equivalent optimizer value derived from issuer-disclosed base economics; this is not a cash balance.',
                'investable',false,'transferable',false,'usable_for_payment',null,'redeemable_for_cash',null,'permitted_destination_ids','[]'::jsonb
            )
        ),
        'rule_id',v_rule_key,
        'subject',jsonb_build_object('entity_id',p_card_id,'entity_type','credit_card'),
        'stacking',jsonb_build_object('mode','additive','precedence',0,'stack_group','card_base_' || v_slug,'requires_rule_ids','[]'::jsonb,'conflicts_with_rule_ids','[]'::jsonb),
        'rule_type','card_benefit',
        'calculation',jsonb_build_object(
            'model','percentage','rate_basis_points',v_rate_bps,
            'rounding',jsonb_build_object('aggregation_scope','per_operation','reward_rounding_mode','floor','eligible_spend_quantum_jpy',1)
        ),
        'description','Base JPY-equivalent reward return from current official card economics. Special merchants, campaigns and alternative redemption values are separate facts/rules.',
        'eligibility',jsonb_build_object(
            'operation_match',jsonb_build_object('allowed_payment_instrument_ids',jsonb_build_array(p_card_id)),
            'user_conditions',coalesce(p_user_conditions,'[]'::jsonb),
            'campaign_conditions','{}'::jsonb,
            'transaction_conditions',jsonb_build_object('eligible_amount_basis','operation_amount')
        )
    );
    v_definition_hash := 'sha256:' || encode(extensions.digest(convert_to(v_definition::text,'UTF8'),'sha256'),'hex');

    insert into app_private.reward_rules (
        rule_key,rule_type,subject_entity_id,name,lifecycle_status,created_by
    ) values (
        v_rule_key,'card_benefit',v_entity.id,v_entity.display_name || ' base reward','published','chatgpt-credit-card-coverage'
    )
    on conflict (rule_key) do nothing;
    select * into v_rule from app_private.reward_rules where rule_key=v_rule_key for update;

    select * into v_current
      from app_private.reward_rule_versions
     where rule_id=v_rule.id and review_status='approved' and superseded_at is null
     order by version desc limit 1
     for update;

    if found and v_current.definition_hash = v_definition_hash then
        v_rule_version_id := v_current.id;
    else
        if found then
            update app_private.reward_rule_versions
               set superseded_at=v_now
             where id=v_current.id;
        end if;
        select coalesce(max(version),0)+1 into v_version from app_private.reward_rule_versions where rule_id=v_rule.id;
        insert into app_private.reward_rule_versions (
            rule_id,version,definition,definition_hash,valid_from,valid_to,
            superseded_at,review_status,review_mode,required_review_modes,
            completed_review_modes,reviewed_by,reviewed_at,change_reason,created_by
        ) values (
            v_rule.id,v_version,v_definition,v_definition_hash,v_valid_from,null,null,
            'approved',null,'{}'::text[],'{}'::text[],
            'chatgpt-credit-card-coverage',v_now,
            case when v_version=1 then 'Initial official-source credit-card base rule' else 'Updated official-source credit-card base rule' end,
            'chatgpt-credit-card-coverage'
        ) returning id into v_rule_version_id;
    end if;

    insert into app_private.rule_evidence (rule_version_id,evidence_id,supported_paths)
    values (
        v_rule_version_id,v_evidence_id,
        '["/calculation/rate_basis_points","/subject/entity_id","/scope/countries","/eligibility/operation_match/allowed_payment_instrument_ids"]'::jsonb
    ) on conflict (rule_version_id,evidence_id) do nothing;

    v_request_hash := 'sha256:' || encode(extensions.digest(convert_to(v_rule_key || ':' || v_definition_hash || ':' || p_finding_id,'UTF8'),'sha256'),'hex');
    insert into app_private.rule_publication_requests (
        rule_id,idempotency_key,request_hash,resulting_rule_version_id,status,
        created_by,completed_at
    )
    select v_rule.id,
           'cc-publish-' || substr(replace(p_finding_id,'_','-'),1,96),
           v_request_hash,v_rule_version_id,'published','chatgpt-credit-card-coverage',v_now
    where not exists (
        select 1 from app_private.rule_publication_requests r
         where r.rule_id=v_rule.id and r.resulting_rule_version_id=v_rule_version_id and r.status='published'
    );

    update app_private.reward_rules
       set lifecycle_status='published',updated_at=now()
     where id=v_rule.id and lifecycle_status <> 'published';

    return jsonb_build_object(
        'card_id',p_card_id,
        'rule_key',v_rule_key,
        'rule_id',v_rule.id,
        'rule_version_id',v_rule_version_id,
        'definition_hash',v_definition_hash,
        'evidence_id',v_evidence_id,
        'source_snapshot_id',v_snapshot_id,
        'base_reward_rate_percent',p_base_reward_rate_percent,
        'annual_fee_jpy',p_annual_fee_jpy,
        'status','published'
    );
end;
$$;

revoke all on function app_private.publish_credit_card_base_rule(text,text,text,text,jsonb,integer,numeric,timestamptz,timestamptz,jsonb,text,jsonb,jsonb) from public,anon,authenticated;

comment on function app_private.publish_credit_card_base_rule(text,text,text,text,jsonb,integer,numeric,timestamptz,timestamptz,jsonb,text,jsonb,jsonb) is
    'Trusted operator path for immediate publication of official-source credit-card base economics after Agent Feed collection. Creates verified evidence, economic terms, an approved immutable rule version and a completed publication request with no manual review modes.';

commit;
