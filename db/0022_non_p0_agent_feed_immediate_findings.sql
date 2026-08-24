-- Immediate, user-correctable projection for accepted non-P0 Agent Feed findings.
-- These records are explicitly experimental and never become canonical rules.

begin;

create table if not exists app_private.agent_feed_experimental_findings (
    projection_id text primary key,
    finding_id text not null unique,
    run_id text not null,
    stream_id text not null,
    producer text not null default 'chatgpt-scheduled-task',
    family_ids text[] not null,
    finding_kind text not null check (finding_kind in ('reward','payment_acceptance','stored_value')),
    title text not null,
    summary text not null,
    claims jsonb not null check (jsonb_typeof(claims) = 'array'),
    source_urls text[] not null,
    evidence jsonb not null default '[]'::jsonb check (jsonb_typeof(evidence) = 'array'),
    confidence numeric(4,3) not null check (confidence >= 0 and confidence <= 1),
    evidence_completeness text not null check (evidence_completeness in ('complete','partial')),
    scope jsonb not null default '{}'::jsonb check (jsonb_typeof(scope) = 'object'),
    status text not null default 'active_experimental'
        check (status in ('active_experimental','disputed','quarantined','superseded')),
    correction_enabled boolean not null default true check (correction_enabled),
    first_reflected_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
    check (cardinality(family_ids) between 1 and 8),
    check (cardinality(source_urls) between 1 and 8)
);

create index if not exists agent_feed_experimental_findings_family_ids_gin
    on app_private.agent_feed_experimental_findings using gin (family_ids);
create index if not exists agent_feed_experimental_findings_active_idx
    on app_private.agent_feed_experimental_findings (status, first_reflected_at desc);

create table if not exists user_data.agent_feed_finding_corrections (
    correction_id uuid primary key default gen_random_uuid(),
    finding_id text not null references app_private.agent_feed_experimental_findings(finding_id) on delete restrict,
    user_id uuid not null,
    category text not null check (category in (
        'not_accepted','reward_missing','rate_wrong','campaign_ended',
        'registration_required','cap_or_minimum_missing','merchant_wrong',
        'product_variant_wrong','security_mismatch','source_mismatch','other'
    )),
    details text check (details is null or char_length(details) <= 2000),
    reported_at timestamptz not null default now()
);

alter table user_data.agent_feed_finding_corrections enable row level security;
revoke all on app_private.agent_feed_experimental_findings from public;
revoke all on user_data.agent_feed_finding_corrections from public;

do $supabase_read_roles$
begin
    if to_regrole('anon') is not null then
        execute 'revoke all on app_private.agent_feed_experimental_findings from anon';
        execute 'revoke all on user_data.agent_feed_finding_corrections from anon';
    end if;
    if to_regrole('authenticated') is not null then
        execute 'revoke all on app_private.agent_feed_experimental_findings from authenticated';
        execute 'revoke all on user_data.agent_feed_finding_corrections from authenticated';
    end if;
end;
$supabase_read_roles$;

create or replace view app_api.active_agent_feed_experimental_findings as
select
    finding_id, run_id, stream_id, producer, family_ids, finding_kind,
    title, summary, claims, source_urls, evidence, confidence,
    evidence_completeness, scope, status, correction_enabled,
    first_reflected_at, updated_at, metadata
from app_private.agent_feed_experimental_findings
where status = 'active_experimental';

revoke all on app_api.active_agent_feed_experimental_findings from public;
grant select on app_api.active_agent_feed_experimental_findings to jro_runtime;

do $supabase_view_roles$
begin
    if to_regrole('anon') is not null then
        execute 'grant usage on schema app_api to anon';
        execute 'grant select on app_api.active_agent_feed_experimental_findings to anon';
    end if;
    if to_regrole('authenticated') is not null then
        execute 'grant usage on schema app_api to authenticated';
        execute 'grant select on app_api.active_agent_feed_experimental_findings to authenticated';
    end if;
end;
$supabase_view_roles$;

create or replace function app_api.flag_agent_feed_experimental_finding(
    p_finding_id text,
    p_category text,
    p_details text default null
)
returns table (correction_id uuid, resulting_status text)
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
    v_user_id uuid := auth.uid();
    v_correction_id uuid;
    v_status text;
begin
    if v_user_id is null then
        raise exception 'authentication required' using errcode = '42501';
    end if;
    if p_category is null or p_category not in (
        'not_accepted','reward_missing','rate_wrong','campaign_ended',
        'registration_required','cap_or_minimum_missing','merchant_wrong',
        'product_variant_wrong','security_mismatch','source_mismatch','other'
    ) or (p_details is not null and char_length(p_details) > 2000) then
        raise exception 'invalid correction report' using errcode = '22023';
    end if;

    perform pg_advisory_xact_lock(hashtextextended(p_finding_id, 0));
    select status into v_status
      from app_private.agent_feed_experimental_findings
     where finding_id = p_finding_id
       and correction_enabled
     for update;
    if not found then
        raise exception 'experimental finding does not exist' using errcode = '23503';
    end if;

    insert into user_data.agent_feed_finding_corrections
        (finding_id, user_id, category, details)
    values (p_finding_id, v_user_id, p_category, p_details)
    returning agent_feed_finding_corrections.correction_id into v_correction_id;

    v_status := case when p_category in ('security_mismatch','source_mismatch')
                     then 'quarantined' else 'disputed' end;
    update app_private.agent_feed_experimental_findings
       set status = v_status, updated_at = now()
     where finding_id = p_finding_id
       and status in ('active_experimental','disputed');

    return query select v_correction_id, v_status;
end;
$$;

revoke all on function app_api.flag_agent_feed_experimental_finding(text,text,text) from public;
do $supabase_correction_role$
begin
    if to_regrole('authenticated') is not null then
        execute 'grant execute on function app_api.flag_agent_feed_experimental_finding(text,text,text) to authenticated';
    end if;
end;
$supabase_correction_role$;

comment on table app_private.agent_feed_experimental_findings is
    'Accepted non-P0 Agent Feed findings reflected immediately as experimental, never canonical, and removable by authenticated correction reports.';
comment on view app_api.active_agent_feed_experimental_findings is
    'Public-safe active subset of immediate non-P0 Agent Feed findings; disputed, quarantined, and superseded rows fail closed.';

insert into app_private.agent_feed_experimental_findings
    (projection_id,finding_id,run_id,stream_id,family_ids,finding_kind,title,summary,claims,source_urls,evidence,confidence,evidence_completeness,scope,metadata)
values
('afp_p1_bic_20260823','finding_p1_bic_point_20260823','d8be02b7-345e-4ce2-a3c3-7695a7ce290d','merchant.jp-electronics',array['point.bic'],'reward','Bic Point basic earning and value','Official Bic Camera material states a basic 10% point rate, 1 point = JPY 1, and expiry two years after last use.',jsonb_build_array(jsonb_build_object('claim','base_rate','spend_percent',10),jsonb_build_object('claim','redemption_value_jpy','points',1,'jpy',1),jsonb_build_object('claim','expiry','years_after_last_use',2)),array['https://www.biccamera.com/bc/c/super/point/bic_point/'],'[]'::jsonb,0.95,'complete','{"country":"JP","channel":"in_store"}'::jsonb,'{"priority":"P1","canonical":false}'::jsonb),
('afp_p1_doutor_20260823','finding_p1_doutor_value_20260823','3dc86831-68b5-4f53-a3c0-01eca2b59492','merchant.jp-food',array['point.doutor-value'],'reward','Doutor Value earning','Official Doutor material states a charge bonus from 5% for charges of at least JPY 2,000 and purchase earning of 1 point per JPY 100; 1 point = JPY 1.',jsonb_build_array(jsonb_build_object('claim','charge_bonus','minimum_jpy',2000,'percent_from',5),jsonb_build_object('claim','purchase_rate','spend_jpy',100,'reward_points',1),jsonb_build_object('claim','redemption_value_jpy','points',1,'jpy',1)),array['https://www.doutor.co.jp/dvc/'],'[]'::jsonb,0.95,'complete','{"country":"JP"}'::jsonb,'{"priority":"P1","canonical":false}'::jsonb),
('afp_p1_starbucks_20260823','finding_p1_starbucks_card_stars_20260823','3dc86831-68b5-4f53-a3c0-01eca2b59492','merchant.jp-food',array['storedvalue.starbucks-card','point.starbucks-stars'],'reward','Starbucks Card and Stars','Registered Starbucks Card or app payments earn 1 Star per JPY 60 including tax; PayPay and Apple Pay are excluded for Mobile Order & Pay.',jsonb_build_array(jsonb_build_object('claim','purchase_rate','spend_jpy_tax_inclusive',60,'reward_stars',1),jsonb_build_object('claim','registration_required','value',true),jsonb_build_object('claim','mobile_order_excluded_tenders','values',jsonb_build_array('PayPay','Apple Pay'))),array['https://www.starbucks.co.jp/rewards/'],'[]'::jsonb,0.95,'complete','{"country":"JP"}'::jsonb,'{"priority":"P1","canonical":false}'::jsonb),
('afp_p1_skylark_20260823','finding_p1_skylark_points_20260823','3dc86831-68b5-4f53-a3c0-01eca2b59492','merchant.jp-food',array['point.skylark'],'reward','Skylark Points','Official Skylark material states 1 point per JPY 200 including tax, 1 point = JPY 1, and stacking with one of Rakuten Point, d POINT, or V Point.',jsonb_build_array(jsonb_build_object('claim','purchase_rate','spend_jpy_tax_inclusive',200,'reward_points',1),jsonb_build_object('claim','redemption_value_jpy','points',1,'jpy',1),jsonb_build_object('claim','stackable_common_points','one_of',jsonb_build_array('point.rakuten','point.d','point.v'))),array['https://www.skylark.co.jp/skpoint/campaign/'],'[]'::jsonb,0.95,'complete','{"country":"JP"}'::jsonb,'{"priority":"P1","canonical":false}'::jsonb),
('afp_p1_tullys_20260823','finding_p1_tullys_beans_20260823','3dc86831-68b5-4f53-a3c0-01eca2b59492','merchant.jp-food',array['point.tullys-beans'],'reward','Tullys Beans','Official Tullys app material states a registered card earns 1 Bean per JPY 1 including tax, with coupon tiers defined by the program.',jsonb_build_array(jsonb_build_object('claim','purchase_rate','spend_jpy_tax_inclusive',1,'reward_beans',1),jsonb_build_object('claim','registered_card_required','value',true),jsonb_build_object('claim','coupon_tiers','value','program_defined')),array['https://www.tullys.co.jp/service/app/'],'[]'::jsonb,0.93,'complete','{"country":"JP"}'::jsonb,'{"priority":"P1","canonical":false}'::jsonb),
('afp_p1_sugi_20260823','finding_p1_sugi_points_20260823','eb8bece0-6f08-4fca-8f93-225d6ac6eaa2','merchant.jp-drugstore',array['point.sugi'],'reward','Sugi Points','Official Sugi material states 1 point per JPY 100 including tax, redemption at 2 points = JPY 1, and a ten-year expiry.',jsonb_build_array(jsonb_build_object('claim','purchase_rate','spend_jpy_tax_inclusive',100,'reward_points',1),jsonb_build_object('claim','redemption_value_jpy','points',2,'jpy',1),jsonb_build_object('claim','expiry','years',10)),array['https://www.sugi-net.jp/service/sugi-point'],'[]'::jsonb,0.95,'complete','{"country":"JP"}'::jsonb,'{"priority":"P1","canonical":false}'::jsonb),
('afp_p1_matsukiyo_20260823','finding_p1_matsukiyococokara_20260823','eb8bece0-6f08-4fca-8f93-225d6ac6eaa2','merchant.jp-drugstore',array['point.matsukiyococokara'],'reward','MatsukiyoCocokara Points','Official program material states 1 point per JPY 100 excluding tax and that points can be used toward payment and rewards.',jsonb_build_array(jsonb_build_object('claim','purchase_rate','spend_jpy_tax_exclusive',100,'reward_points',1),jsonb_build_object('claim','usable_for_payment','value',true)),array['https://www.matsukiyococokara-online.com/point'],'[]'::jsonb,0.95,'complete','{"country":"JP"}'::jsonb,'{"priority":"P1","canonical":false}'::jsonb),
('afp_p1_ok_id_20260823','finding_p1_ok_id_acceptance_20260823','5716c131-2ac3-4aa1-8dd2-350dcc3db7cf','merchant.jp-supermarket',array['emoney.id'],'payment_acceptance','OK accepts iD','OK official newcomer material lists iD as accepted and states cashless tenders are not eligible for the OK 3% equivalent discount.',jsonb_build_array(jsonb_build_object('claim','accepted','value',true),jsonb_build_object('claim','ok_discount_eligible','value',false)),array['https://ok-corporation.jp/feature/newcomer.html'],'[]'::jsonb,0.94,'complete','{"country":"JP","merchant":"OK"}'::jsonb,'{"priority":"P1","canonical":false}'::jsonb),
('afp_p1_ok_quicpay_20260823','finding_p1_ok_quicpay_acceptance_20260823','5716c131-2ac3-4aa1-8dd2-350dcc3db7cf','merchant.jp-supermarket',array['emoney.quicpay'],'payment_acceptance','OK accepts QUICPay','OK official newcomer material lists QUICPay as accepted and states cashless tenders are not eligible for the OK 3% equivalent discount.',jsonb_build_array(jsonb_build_object('claim','accepted','value',true),jsonb_build_object('claim','ok_discount_eligible','value',false)),array['https://ok-corporation.jp/feature/newcomer.html'],'[]'::jsonb,0.94,'complete','{"country":"JP","merchant":"OK"}'::jsonb,'{"priority":"P1","canonical":false}'::jsonb),
('afp_p1_ok_transit_20260823','finding_p1_ok_transit_ic_acceptance_20260823','5716c131-2ac3-4aa1-8dd2-350dcc3db7cf','merchant.jp-supermarket',array['transit.ic-generic'],'payment_acceptance','OK accepts transit IC','OK official newcomer material lists transit IC as accepted and states cashless tenders are not eligible for the OK 3% equivalent discount.',jsonb_build_array(jsonb_build_object('claim','accepted','value',true),jsonb_build_object('claim','ok_discount_eligible','value',false)),array['https://ok-corporation.jp/feature/newcomer.html'],'[]'::jsonb,0.94,'complete','{"country":"JP","merchant":"OK"}'::jsonb,'{"priority":"P1","canonical":false}'::jsonb),
('afp_p1_ministop_edy_20260823','finding_p1_ministop_edy_acceptance_20260823','5d01c6a4-7efc-448f-9fb6-851e86e5fba3','merchant.jp-convenience',array['emoney.rakuten-edy'],'payment_acceptance','MINISTOP Midori 2-chome accepts Rakuten Edy','The official store page for the Tokyo MINISTOP Midori 2-chome location lists Rakuten Edy acceptance; this is location-specific.',jsonb_build_array(jsonb_build_object('claim','accepted','value',true),jsonb_build_object('claim','location_specific','value',true)),array['https://map.ministop.co.jp/detail/0000000101/'],'[]'::jsonb,0.92,'complete','{"country":"JP","merchant":"MINISTOP","location":"Midori 2-chome, Tokyo"}'::jsonb,'{"priority":"P1","canonical":false}'::jsonb),
('afp_p1_majica_20260823','finding_p1_majica_roles_20260823','0b93fdf3-cfe9-41be-835c-142a754e2ce5','merchant.jp-retail',array['point.majica','storedvalue.majica'],'stored_value','majica points and money','Official majica material states 1 point per JPY 200 (0.5%), 1 point = JPY 1, registration is required, and majica Money is the stored-value role.',jsonb_build_array(jsonb_build_object('claim','purchase_rate','spend_jpy',200,'reward_points',1,'percent',0.5),jsonb_build_object('claim','redemption_value_jpy','points',1,'jpy',1),jsonb_build_object('claim','registration_required','value',true),jsonb_build_object('claim','stored_value_role','family_id','storedvalue.majica')),array['https://www.majica-net.com/guide/point/'],'[]'::jsonb,0.95,'complete','{"country":"JP"}'::jsonb,'{"priority":"P1","canonical":false}'::jsonb)
on conflict (finding_id) do update set
    run_id = excluded.run_id,
    stream_id = excluded.stream_id,
    family_ids = excluded.family_ids,
    finding_kind = excluded.finding_kind,
    title = excluded.title,
    summary = excluded.summary,
    claims = excluded.claims,
    source_urls = excluded.source_urls,
    evidence = excluded.evidence,
    confidence = excluded.confidence,
    evidence_completeness = excluded.evidence_completeness,
    scope = excluded.scope,
    updated_at = now(),
    metadata = excluded.metadata,
    status = case when app_private.agent_feed_experimental_findings.status in ('disputed','quarantined')
                  then app_private.agent_feed_experimental_findings.status else excluded.status end;

with completed(entity_key,source_url) as (values
('program.jp.bicpoint','https://www.biccamera.com/bc/c/super/point/bic_point/'),
('program.jp.doutor-value','https://www.doutor.co.jp/dvc/'),
('instrument.starbucks.card','https://www.starbucks.co.jp/rewards/'),
('program.jp.starbucks-stars','https://www.starbucks.co.jp/rewards/'),
('program.jp.skylark','https://www.skylark.co.jp/skpoint/campaign/'),
('program.jp.tullys-beans','https://www.tullys.co.jp/service/app/'),
('program.jp.sugi-point','https://www.sugi-net.jp/service/sugi-point'),
('program.jp.matsukiyococokara','https://www.matsukiyococokara-online.com/point'),
('instrument.emoney.id','https://ok-corporation.jp/feature/newcomer.html'),
('instrument.emoney.quicpay','https://ok-corporation.jp/feature/newcomer.html'),
('instrument.emoney.transit_ic','https://ok-corporation.jp/feature/newcomer.html'),
('instrument.emoney.rakuten_edy','https://map.ministop.co.jp/detail/0000000101/'),
('program.jp.majica','https://www.majica-net.com/guide/point/'),
('instrument.majica.money','https://www.majica-net.com/guide/point/'))
update app_private.ecosystem_family_backlog b
set agent_feed_status='accepted', research_status='covered', first_source_url=completed.source_url,
    updated_at=now(), metadata=b.metadata || '{"immediate_projection":"active_experimental","user_correction_enabled":true}'::jsonb
from completed where b.entity_key=completed.entity_key;

update app_private.ecosystem_family_backlog
set agent_feed_status='submitted', research_status='partial', updated_at=now(),
    metadata=metadata || '{"last_error":"official_source_http_403","retryable":true}'::jsonb
where entity_key='program.jp.yodobashi-goldpoint';

commit;
