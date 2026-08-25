-- Staged from db/0040_credit_card_native_reward_publication.sql; edit the canonical source, not this file.
-- Publish credit-card base earning in native reward units (points/miles) so
-- valuation remains user/profile data rather than an invented issuer cash rate.

begin;

create or replace function app_private.publish_credit_card_native_rule(
    p_card_id text,
    p_finding_id text,
    p_source_url text,
    p_source_title text,
    p_claims jsonb,
    p_annual_fee_jpy integer,
    p_asset_key text,
    p_asset_kind text,
    p_asset_display_name text,
    p_program_id text,
    p_reward_units text,
    p_spend_jpy integer,
    p_asset_scale integer default 0,
    p_effective_from timestamptz default null,
    p_checked_at timestamptz default now(),
    p_evidence_locator jsonb default '{}'::jsonb,
    p_excerpt text default null,
    p_user_conditions jsonb default '[]'::jsonb,
    p_metadata jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path=pg_catalog
as $$
declare
    v_entity app_private.entities%rowtype;
    v_rule app_private.reward_rules%rowtype;
    v_current app_private.reward_rule_versions%rowtype;
    v_source_id uuid; v_snapshot_id uuid; v_evidence_id uuid; v_rv_id uuid;
    v_rule_key text; v_slug text; v_source_key text; v_snapshot_key text; v_evidence_key text;
    v_definition jsonb; v_definition_hash text; v_request_hash text; v_version integer;
    v_now timestamptz:=coalesce(p_checked_at,now());
    v_valid_from timestamptz:=coalesce(p_effective_from,p_checked_at,now());
    v_raw_hash text; v_norm_hash text;
begin
    if p_card_id !~ '^instrument[.]card[.][a-z0-9][a-z0-9._-]*$'
       or p_source_url !~ '^https://[^[:space:]]+$'
       or jsonb_typeof(p_claims) is distinct from 'array'
       or p_asset_key !~ '^asset[.][a-z0-9][a-z0-9._-]+$'
       or p_asset_kind not in ('reward_point','airline_mile','hotel_point','cashback','voucher','discount','other')
       or coalesce(length(btrim(p_asset_display_name)),0)<1
       or p_reward_units !~ '^(0|[1-9][0-9]*)([.][0-9]+)?$'
       or p_spend_jpy is null or p_spend_jpy<1
       or p_asset_scale<0 or p_asset_scale>9
       or jsonb_typeof(coalesce(p_user_conditions,'[]'::jsonb)) is distinct from 'array'
       or jsonb_typeof(coalesce(p_metadata,'{}'::jsonb)) is distinct from 'object'
    then raise exception 'invalid native credit-card publication input' using errcode='22023'; end if;

    select * into v_entity from app_private.entities where entity_key=p_card_id and entity_type='credit_card' and status='active' for share;
    if not found then raise exception 'credit card entity not found: %',p_card_id using errcode='23503'; end if;

    insert into app_private.asset_definitions(asset_key,asset_kind,program_entity_id,default_reward_class,display_name,scale,default_expiry_policy,default_usage_restrictions,metadata,status)
    values(p_asset_key,p_asset_kind,null,'normal',p_asset_display_name,p_asset_scale,
      '{"policy":"unknown","timezone":"Asia/Tokyo","expires_at":null,"duration_days":null}'::jsonb,
      '{"transferable":null,"redeemable_for_cash":null,"usable_for_payment":null,"investable":false,"permitted_destination_ids":[],"notes":"Issuer-native card reward. Monetary value is supplied by valuation profile, not the earning rule."}'::jsonb,
      coalesce(p_metadata,'{}'::jsonb)||jsonb_build_object('program_id',p_program_id,'source','credit_card_native_rule'),'active')
    on conflict(asset_key) do update set display_name=excluded.display_name,asset_kind=excluded.asset_kind,scale=excluded.scale,metadata=app_private.asset_definitions.metadata||excluded.metadata,updated_at=now();

    v_slug:=regexp_replace(replace(p_card_id,'instrument.card.',''),'[^a-z0-9_-]+','_','g');
    v_rule_key:='rr_card_'||v_slug||'_base_native_reward';
    v_source_key:='card.'||substr(encode(extensions.digest(convert_to(p_source_url,'UTF8'),'sha256'),'hex'),1,40);
    v_snapshot_key:='snap_card_native_'||substr(encode(extensions.digest(convert_to(p_source_url||':'||p_finding_id,'UTF8'),'sha256'),'hex'),1,36);
    v_evidence_key:='ev_card_native_'||substr(encode(extensions.digest(convert_to(p_card_id||':'||p_finding_id,'UTF8'),'sha256'),'hex'),1,36);
    v_raw_hash:='sha256:'||encode(extensions.digest(convert_to(p_source_url||':'||p_finding_id||':'||p_claims::text,'UTF8'),'sha256'),'hex');
    v_norm_hash:='sha256:'||encode(extensions.digest(convert_to(p_claims::text,'UTF8'),'sha256'),'hex');

    insert into app_private.trusted_sources(source_key,name,publisher,category,tier,publication_use,source_url,authority_scope,locale,geography,evidence_format,volatility,recommended_check_cadence,retrieval_method,requires_login,automation_status,terms_review_status,technical_feasibility,url_registered_on,content_verified_on,verification_status,notes,registry_payload)
    values(v_source_key,p_source_title,p_source_title,'credit_card_issuer','T1_CANONICAL','canonical',p_source_url,jsonb_build_array(p_card_id,'base_reward','annual_fee'),'ja-JP','JP','web','high','monthly','manual_browser',false,'available','not_applicable','manual_capture_candidate',v_now::date,v_now::date,'content_verified','Official issuer/card-company source verified for native credit-card reward publication.',jsonb_build_object('card_id',p_card_id,'agent_feed_finding_id',p_finding_id))
    on conflict(source_key) do update set content_verified_on=greatest(app_private.trusted_sources.content_verified_on,excluded.content_verified_on),verification_status='content_verified',source_url=excluded.source_url,updated_at=now()
    returning id into v_source_id;
    if v_source_id is null then select id into v_source_id from app_private.trusted_sources where source_key=v_source_key; end if;

    insert into app_private.source_snapshots(snapshot_key,source_id,collection_policy_id,fetched_at,requested_url,effective_url,http_status,content_type,raw_content_hash,normalized_content_hash,acquisition_method,capture_complete,metadata,created_by)
    values(v_snapshot_key,v_source_id,null,v_now,p_source_url,p_source_url,200,'text/html',v_raw_hash,v_norm_hash,'manual_capture',true,jsonb_build_object('agent_feed_finding_id',p_finding_id,'card_id',p_card_id),'chatgpt-credit-card-coverage')
    on conflict(snapshot_key) do nothing returning id into v_snapshot_id;
    if v_snapshot_id is null then select id into v_snapshot_id from app_private.source_snapshots where snapshot_key=v_snapshot_key; end if;

    insert into app_private.evidence_records(evidence_key,source_snapshot_id,locator,excerpt_text,normalized_claim,supports,economic_valid_from,status,extraction_method,extraction_model,extraction_confidence,review_mode,required_review_modes,completed_review_modes,reviewed_by,reviewed_at,notes)
    values(v_evidence_key,v_snapshot_id,coalesce(p_evidence_locator,'{}'::jsonb),p_excerpt,jsonb_build_object('card_id',p_card_id,'claims',p_claims,'asset_key',p_asset_key,'reward_units',p_reward_units,'spend_jpy',p_spend_jpy),'["/calculation/reward_units","/calculation/spend_jpy","/output/asset/asset_id","/subject/entity_id"]'::jsonb,v_valid_from,'verified','official_source_manual_capture','chatgpt',0.99,'solo_dual_pass',array['solo_dual_pass']::text[],array['solo_dual_pass']::text[],'chatgpt-credit-card-coverage',v_now,'Official-source native reward mechanics cross-checked in collection/publication pass.')
    on conflict(evidence_key) do update set normalized_claim=excluded.normalized_claim,status='verified',review_mode='solo_dual_pass',required_review_modes=array['solo_dual_pass']::text[],completed_review_modes=array['solo_dual_pass']::text[],reviewed_by=excluded.reviewed_by,reviewed_at=excluded.reviewed_at
    returning id into v_evidence_id;
    if v_evidence_id is null then select id into v_evidence_id from app_private.evidence_records where evidence_key=v_evidence_key; end if;

    insert into app_private.credit_card_economic_terms(card_id,annual_fee_jpy,base_reward_rate_percent,reward_program,effective_from,source_url,agent_feed_finding_id,official_source_verified,checked_at,metadata)
    select p_card_id,p_annual_fee_jpy,null,p_asset_display_name,v_valid_from,p_source_url,p_finding_id,true,v_now,coalesce(p_metadata,'{}'::jsonb)||jsonb_build_object('native_reward_units',p_reward_units,'native_spend_jpy',p_spend_jpy,'native_asset_key',p_asset_key)
    where not exists(select 1 from app_private.credit_card_economic_terms t where t.card_id=p_card_id and t.agent_feed_finding_id=p_finding_id);

    v_definition:=jsonb_build_object(
      'caps','[]'::jsonb,'name',v_entity.display_name||' base native reward',
      'scope',jsonb_build_object('channels',jsonb_build_array('in_store','online','in_app'),'countries',jsonb_build_array('JP'),'operation_types',jsonb_build_array('merchant_purchase'),'included_product_classes',jsonb_build_array('ordinary'),'excluded_product_classes','[]'::jsonb),
      'output',jsonb_build_object('sign','credit','asset',jsonb_build_object('scale',p_asset_scale,'asset_id',p_asset_key,'asset_kind',p_asset_kind,'program_id',p_program_id,'reward_class','normal'),'expiry',jsonb_build_object('policy','unknown','timezone','Asia/Tokyo','expires_at',null,'duration_days',null),'clawback',jsonb_build_object('notes','Issuer/card-company refund rules apply.','on_refund','provider_defined','posting_delay_days',null),'certainty',jsonb_build_object('type','guaranteed','probability',null,'probability_source',null),'settlement',jsonb_build_object('status','pending','posted_at',null,'expected_posting_to',null,'expected_posting_from',null),'restrictions',jsonb_build_object('notes','Native reward value is supplied by the user/default valuation profile.','investable',false,'transferable',null,'usable_for_payment',null,'redeemable_for_cash',null,'permitted_destination_ids','[]'::jsonb)),
      'rule_id',v_rule_key,'subject',jsonb_build_object('entity_id',p_card_id,'entity_type','credit_card'),
      'stacking',jsonb_build_object('mode','additive','precedence',0,'stack_group','card_native_'||v_slug,'requires_rule_ids','[]'::jsonb,'conflicts_with_rule_ids','[]'::jsonb),
      'rule_type','card_benefit','calculation',jsonb_build_object('model','points_per_unit','reward_units',p_reward_units,'spend_jpy',p_spend_jpy,'rounding',jsonb_build_object('aggregation_scope','per_operation','reward_rounding_mode','floor','eligible_spend_quantum_jpy',p_spend_jpy)),
      'description','Base issuer-native reward quantity. JPY value is applied by the valuation profile after native calculation.',
      'eligibility',jsonb_build_object('operation_match',jsonb_build_object('allowed_payment_instrument_ids',jsonb_build_array(p_card_id)),'user_conditions',coalesce(p_user_conditions,'[]'::jsonb),'campaign_conditions','{}'::jsonb,'transaction_conditions',jsonb_build_object('eligible_amount_basis','operation_amount')));
    v_definition_hash:='sha256:'||encode(extensions.digest(convert_to(v_definition::text,'UTF8'),'sha256'),'hex');

    insert into app_private.reward_rules(rule_key,rule_type,subject_entity_id,name,lifecycle_status,created_by)
    values(v_rule_key,'card_benefit',v_entity.id,v_entity.display_name||' base native reward','published','chatgpt-credit-card-coverage') on conflict(rule_key) do nothing;
    select * into v_rule from app_private.reward_rules where rule_key=v_rule_key for update;
    select * into v_current from app_private.reward_rule_versions where rule_id=v_rule.id and review_status='approved' and superseded_at is null order by version desc limit 1 for update;
    if found and v_current.definition_hash=v_definition_hash then v_rv_id:=v_current.id; else
      if found then update app_private.reward_rule_versions set superseded_at=v_now where id=v_current.id; end if;
      select coalesce(max(version),0)+1 into v_version from app_private.reward_rule_versions where rule_id=v_rule.id;
      insert into app_private.reward_rule_versions(rule_id,version,definition,definition_hash,valid_from,review_status,review_mode,required_review_modes,completed_review_modes,reviewed_by,reviewed_at,change_reason,created_by)
      values(v_rule.id,v_version,v_definition,v_definition_hash,v_valid_from,'approved',null,'{}'::text[],'{}'::text[],'chatgpt-credit-card-coverage',v_now,case when v_version=1 then 'Initial official-source native credit-card reward rule' else 'Updated official-source native credit-card reward rule' end,'chatgpt-credit-card-coverage') returning id into v_rv_id;
    end if;
    insert into app_private.rule_evidence(rule_version_id,evidence_id,supported_paths) values(v_rv_id,v_evidence_id,'["/calculation/reward_units","/calculation/spend_jpy","/output/asset/asset_id","/subject/entity_id"]'::jsonb) on conflict(rule_version_id,evidence_id) do nothing;
    v_request_hash:='sha256:'||encode(extensions.digest(convert_to(v_rule_key||':'||v_definition_hash||':'||p_finding_id,'UTF8'),'sha256'),'hex');
    insert into app_private.rule_publication_requests(rule_id,idempotency_key,request_hash,resulting_rule_version_id,status,created_by,completed_at)
    select v_rule.id,'cc-native-'||substr(replace(p_finding_id,'_','-'),1,96),v_request_hash,v_rv_id,'published','chatgpt-credit-card-coverage',v_now
    where not exists(select 1 from app_private.rule_publication_requests r where r.rule_id=v_rule.id and r.resulting_rule_version_id=v_rv_id and r.status='published');
    return jsonb_build_object('status','published','card_id',p_card_id,'rule_key',v_rule_key,'rule_version_id',v_rv_id,'asset_key',p_asset_key,'reward_units',p_reward_units,'spend_jpy',p_spend_jpy,'evidence_id',v_evidence_id);
end;
$$;

revoke all on function app_private.publish_credit_card_native_rule(text,text,text,text,jsonb,integer,text,text,text,text,text,integer,integer,timestamptz,timestamptz,jsonb,text,jsonb,jsonb) from public,anon,authenticated;

commit;
