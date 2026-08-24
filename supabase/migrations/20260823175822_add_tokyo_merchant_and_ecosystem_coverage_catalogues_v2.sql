create table if not exists app_private.tokyo_merchant_family_catalogue (
  family_id text primary key check (family_id ~ '^merchant\.[a-z0-9][a-z0-9._-]+$'),
  display_name text not null check (length(btrim(display_name)) > 0),
  category text not null check (category in ('convenience','cafe','qsr','restaurant','drugstore','supermarket','discount','electronics','department_store','fashion','home_living','transport_retail','other')),
  priority text not null check (priority in ('P0','P1','P2')),
  entity_key text null references app_private.entities(entity_key) on update cascade on delete set null,
  target_sample_locations integer not null default 5 check (target_sample_locations >= 1 and target_sample_locations <= 50),
  requires_payment_coverage boolean not null default true,
  requires_reward_coverage boolean not null default false,
  stream_id text null references app_private.monitor_stream_expectations(stream_id) on update cascade on delete set null,
  rationale text null,
  metadata jsonb not null default '{}'::jsonb,
  status text not null default 'active' check (status in ('active','deferred','retired')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists tokyo_merchant_family_catalogue_priority_idx
  on app_private.tokyo_merchant_family_catalogue(priority, category, family_id)
  where status='active';

create table if not exists app_private.ecosystem_family_backlog (
  entity_key text primary key references app_private.entities(entity_key) on update cascade on delete cascade,
  display_name text not null,
  entity_type text not null,
  proposed_priority text not null default 'P2' check (proposed_priority in ('P0','P1','P2')),
  canonical_family_id text null,
  existing_p0_family_id text null,
  research_status text not null default 'queued' check (research_status in ('queued','researching','partial','covered','not_needed')),
  agent_feed_status text not null default 'pending' check (agent_feed_status in ('pending','ready','submitted','accepted','not_required')),
  first_discovered_merchant_family_id text null references app_private.tokyo_merchant_family_catalogue(family_id) on update cascade on delete set null,
  first_source_url text null,
  discovery_origin text not null default 'auto_entity_capture',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists ecosystem_family_backlog_queue_idx
  on app_private.ecosystem_family_backlog(agent_feed_status, proposed_priority, research_status, entity_type);

create or replace function app_private.capture_ecosystem_family_candidate()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, app_private
as $$
begin
  if new.entity_type in ('loyalty_program','qr_wallet','electronic_money','stored_value_program','credit_card','debit_card','prepaid_card','airline_program','hotel_program') then
    insert into app_private.ecosystem_family_backlog(entity_key, display_name, entity_type)
    values (new.entity_key, new.display_name, new.entity_type)
    on conflict (entity_key) do update
      set display_name=excluded.display_name,
          entity_type=excluded.entity_type,
          updated_at=now();
  end if;
  return new;
end;
$$;

drop trigger if exists trg_capture_ecosystem_family_candidate on app_private.entities;
create trigger trg_capture_ecosystem_family_candidate
after insert or update of entity_key, entity_type, display_name on app_private.entities
for each row execute function app_private.capture_ecosystem_family_candidate();

create or replace view app_api.tokyo_merchant_coverage as
with live as (
  select
    c.family_id,
    c.display_name,
    c.category,
    c.priority,
    c.entity_key,
    c.target_sample_locations,
    c.requires_payment_coverage,
    c.requires_reward_coverage,
    c.stream_id,
    c.rationale,
    c.metadata,
    c.status,
    e.id as merchant_entity_id,
    count(distinct ml.id) filter (where ml.valid_to is null) as location_count,
    count(distinct maf.id) filter (where maf.status='active' and maf.valid_to is null) as acceptance_fact_count,
    count(distinct mtr.id) filter (where mtr.status='active' and mtr.valid_to is null) as reward_fact_count
  from app_private.tokyo_merchant_family_catalogue c
  left join app_private.entities e on e.entity_key=c.entity_key and e.entity_type='merchant'
  left join app_private.merchant_locations ml on ml.merchant_entity_id=e.id
  left join app_private.current_merchant_acceptance_facts maf on maf.merchant_entity_id=e.id
  left join app_private.current_merchant_tender_reward_facts mtr on mtr.merchant_entity_id=e.id
  group by c.family_id,c.display_name,c.category,c.priority,c.entity_key,c.target_sample_locations,
           c.requires_payment_coverage,c.requires_reward_coverage,c.stream_id,c.rationale,c.metadata,c.status,e.id
)
select *,
  case
    when merchant_entity_id is null then 'missing'
    when location_count = 0 then 'entity_only'
    when location_count < target_sample_locations then 'location_partial'
    when requires_payment_coverage and acceptance_fact_count = 0 then 'payment_missing'
    when requires_reward_coverage and reward_fact_count = 0 then 'reward_missing'
    when (not requires_payment_coverage or acceptance_fact_count > 0)
      and (not requires_reward_coverage or reward_fact_count > 0)
      and location_count >= target_sample_locations then 'covered'
    else 'partial'
  end as coverage_state,
  least(1.0,
    (case when merchant_entity_id is not null then 0.15 else 0 end) +
    (case when location_count > 0 then 0.20 * least(1.0, location_count::numeric / target_sample_locations) else 0 end) +
    (case when not requires_payment_coverage then 0.35 when acceptance_fact_count > 0 then 0.35 else 0 end) +
    (case when not requires_reward_coverage then 0.30 when reward_fact_count > 0 then 0.30 else 0 end)
  )::numeric(5,2) as coverage_score
from live;

create or replace view app_api.ecosystem_family_backlog_current as
with usage_rows as (
  select i.entity_key, m.entity_key as merchant_entity_key
  from app_private.entities i
  join app_private.merchant_acceptance_facts a on a.instrument_entity_id=i.id and a.status='active' and a.valid_to is null
  join app_private.entities m on m.id=a.merchant_entity_id
  union
  select i.entity_key, m.entity_key as merchant_entity_key
  from app_private.entities i
  join app_private.merchant_tender_reward_facts r on (r.loyalty_program_entity_id=i.id or r.payment_instrument_entity_id=i.id)
      and r.status='active' and r.valid_to is null
  join app_private.entities m on m.id=r.merchant_entity_id
), agg as (
  select entity_key,
         count(distinct merchant_entity_key) as merchant_count,
         array_agg(distinct merchant_entity_key order by merchant_entity_key) as merchant_entity_keys
  from usage_rows
  group by entity_key
)
select b.*,
       coalesce(a.merchant_count,0) as encountered_merchant_count,
       coalesce(a.merchant_entity_keys,array[]::text[]) as encountered_merchants
from app_private.ecosystem_family_backlog b
left join agg a using(entity_key);
