-- Staged from db/0039_credit_card_ingest_publish_helper.sql; edit the canonical source, not this file.
-- Trusted one-card helper: one native Agent Feed bounded run followed by
-- immediate canonical publication from the same official-source facts.

begin;

create or replace function app_private.ingest_and_publish_credit_card_base_fact(
    p_card_id text,
    p_source_url text,
    p_source_title text,
    p_summary text,
    p_claims jsonb,
    p_annual_fee_jpy integer,
    p_base_reward_rate_percent numeric,
    p_effective_from timestamptz default null,
    p_locator jsonb default '{}'::jsonb,
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
    v_card record;
    v_slug text;
    v_digest text;
    v_finding_id text;
    v_evidence_id text;
    v_source_id text;
    v_stream_id text;
    v_now timestamptz := now();
    v_begin jsonb;
    v_batch jsonb;
    v_complete jsonb;
    v_agent_receipt jsonb;
    v_publication jsonb;
    v_projection jsonb;
begin
    if p_card_id is null
       or p_card_id !~ '^instrument[.]card[.][a-z0-9][a-z0-9._-]*$'
       or p_source_url is null
       or p_source_url !~ '^https://[^[:space:]]+$'
       or coalesce(length(btrim(p_source_title)),0) < 1
       or coalesce(length(btrim(p_summary)),0) < 3
       or jsonb_typeof(p_claims) is distinct from 'array'
       or p_base_reward_rate_percent is null
       or p_base_reward_rate_percent < 0
       or p_base_reward_rate_percent > 100
       or jsonb_typeof(coalesce(p_locator,'{}'::jsonb)) is distinct from 'object'
       or jsonb_typeof(coalesce(p_user_conditions,'[]'::jsonb)) is distinct from 'array'
       or jsonb_typeof(coalesce(p_metadata,'{}'::jsonb)) is distinct from 'object'
    then
        raise exception 'invalid credit-card ingest/publish input' using errcode='22023';
    end if;

    select c.card_id,c.display_name,c.coverage_tier,c.coverage_priority
      into v_card
      from app_api.credit_card_coverage c
     where c.card_id=p_card_id;
    if not found then
        raise exception 'credit-card coverage entity not found: %',p_card_id using errcode='23503';
    end if;

    v_slug := regexp_replace(replace(p_card_id,'instrument.card.',''),'[^a-z0-9_-]+','_','g');
    v_digest := substr(encode(extensions.digest(convert_to(p_card_id||':'||p_source_url||':'||p_claims::text,'UTF8'),'sha256'),'hex'),1,20);
    v_finding_id := 'finding_card_'||v_slug||'_'||v_digest;
    v_evidence_id := 'evidence_card_'||v_slug||'_'||v_digest;
    v_source_id := 'jp.card.'||v_digest;
    v_stream_id := 'economy.card-'||regexp_replace(v_slug,'_','-','g');

    v_projection := jsonb_build_object(
        'version','agent-feed-experimental-projection.v1',
        'family_ids',jsonb_build_array(p_card_id),
        'finding_kind','reward',
        'title',v_card.display_name||' current base economics',
        'claims',p_claims,
        'source_urls',jsonb_build_array(p_source_url),
        'evidence',jsonb_build_array(jsonb_build_object(
            'evidence_id',v_evidence_id,
            'source_id',v_source_id,
            'source_url',p_source_url,
            'locator',coalesce(p_locator,'{}'::jsonb)
        )),
        'scope',jsonb_build_object('country','JP','card_id',p_card_id),
        'metadata',coalesce(p_metadata,'{}'::jsonb)||jsonb_build_object(
            'priority',v_card.coverage_tier,
            'coverage_priority',v_card.coverage_priority,
            'canonical',false,
            'official_source_verified',true
        )
    );

    v_begin := jsonb_build_object(
        'protocol_version','0.1',
        'idempotency_key','cc-'||v_digest||'-begin-v1',
        'stream_id',v_stream_id,
        'producer',jsonb_build_object('producer_id','chatgpt-scheduled-task','type','chatgpt','name','ChatGPT Japan credit-card coverage','version','1'),
        'task',jsonb_build_object('task_type','credit_card_optimization_coverage','definition_id','credit-card.'||lower(v_card.coverage_tier)||'.'||v_slug,'definition_version','v1'),
        'expected_scope',jsonb_build_object('source_ids',jsonb_build_array(v_source_id),'subjects',jsonb_build_array(p_card_id),'queries',jsonb_build_array(v_card.display_name||' current economics'),'metadata',jsonb_build_object('coverage_tier',v_card.coverage_tier,'coverage_priority',v_card.coverage_priority,'country','JP','bounded',true,'pii_free',true)),
        'started_at',to_char(v_now at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
        'parent_run_id',null,
        'metadata',jsonb_build_object('purpose','credit-card optimization coverage','card_id',p_card_id,'canonical',false)
    );

    v_batch := jsonb_build_object(
        'protocol_version','0.1',
        'batch_id','cc-'||v_digest||'-batch-v1',
        'idempotency_key','cc-'||v_digest||'-batch-v1',
        'sequence_number',1,
        'submitted_at',to_char((v_now+interval '1 second') at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
        'findings',jsonb_build_array(jsonb_build_object(
            'finding_id',v_finding_id,
            'finding_type','rewards.program_change',
            'title',v_card.display_name||' current base economics',
            'summary',p_summary,
            'subjects',jsonb_build_array(jsonb_build_object('type','credit_card','id',p_card_id,'name',v_card.display_name)),
            'effective_time',jsonb_build_object('occurred_at',to_char(v_now at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),'effective_from',case when p_effective_from is null then null else to_char(p_effective_from at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') end,'effective_to',null),
            'assessment',jsonb_build_object('novelty','new','source_authority_claim','primary','evidence_completeness','complete','agent_confidence',0.99),
            'evidence_refs',jsonb_build_array(v_evidence_id),
            'producer_dedupe_key',p_card_id||'|base-economics|'||v_digest,
            'routing_tags',jsonb_build_array('country:jp','coverage:'||lower(v_card.coverage_tier),'instrument:card','card:'||v_slug),
            'attributes',jsonb_build_object(
                'change_type','reward_rate',
                'source_id',v_source_id,
                'card_id',p_card_id,
                'annual_fee_jpy',p_annual_fee_jpy,
                'base_reward_rate_percent',p_base_reward_rate_percent,
                'claims',p_claims,
                'canonical_publication',false,
                'human_verified',false,
                'experimental_projection',v_projection
            ),
            'security_flags','[]'::jsonb
        )),
        'evidence',jsonb_build_array(jsonb_build_object(
            'evidence_id',v_evidence_id,
            'kind','web',
            'source',jsonb_build_object('uri',p_source_url,'title',p_source_title,'publisher',p_source_title,'source_id',v_source_id),
            'captured_at',to_char(v_now at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
            'published_at',null,
            'locator',case when p_locator='{}'::jsonb then null else p_locator end,
            'excerpt',p_excerpt,
            'content_hash',null,
            'artifact',jsonb_build_object('uri',null,'media_type',null,'size_bytes',null),
            'handling',jsonb_build_object('contains_personal_data',false,'contains_secrets',false,'redistribution_restricted',false),
            'metadata',jsonb_build_object('official_source',true,'country','JP','card_id',p_card_id)
        )),
        'metadata',jsonb_build_object('coverage_tier',v_card.coverage_tier,'coverage_priority',v_card.coverage_priority,'card_id',p_card_id,'bounded',true,'canonical',false)
    );

    v_complete := jsonb_build_object(
        'protocol_version','0.1',
        'idempotency_key','cc-'||v_digest||'-complete-v1',
        'status','completed',
        'completed_at',to_char((v_now+interval '2 seconds') at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
        'actual_scope',v_begin->'expected_scope',
        'stats',jsonb_build_object('sources_attempted',1,'sources_succeeded',1,'findings_submitted',1,'evidence_submitted',1,'batches_submitted',1),
        'errors','[]'::jsonb,
        'metadata',jsonb_build_object('card_id',p_card_id,'canonical',false,'reflection_mode','active_experimental')
    );

    v_agent_receipt := app_private.agent_feed_submit_bounded_single_batch_fallback(v_begin,v_batch,v_complete,'default');
    v_publication := app_private.publish_credit_card_base_rule(
        p_card_id,v_finding_id,p_source_url,p_source_title,p_claims,p_annual_fee_jpy,
        p_base_reward_rate_percent,p_effective_from,v_now,coalesce(p_locator,'{}'::jsonb),
        p_excerpt,coalesce(p_user_conditions,'[]'::jsonb),coalesce(p_metadata,'{}'::jsonb)||jsonb_build_object('official_source_verified',true)
    );

    return jsonb_build_object('agent_feed',v_agent_receipt,'publication',v_publication,'finding_id',v_finding_id,'evidence_id',v_evidence_id);
end;
$$;

revoke all on function app_private.ingest_and_publish_credit_card_base_fact(text,text,text,text,jsonb,integer,numeric,timestamptz,jsonb,text,jsonb,jsonb) from public,anon,authenticated;

commit;
