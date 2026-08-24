create or replace function app_private.capture_ecosystem_usage_from_merchant_fact()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, app_private
as $$
declare
  merchant_key text;
  merchant_family text;
  candidate_id uuid;
  candidate_key text;
  candidate_name text;
  candidate_type text;
begin
  select entity_key into merchant_key from app_private.entities where id=new.merchant_entity_id;
  select family_id into merchant_family
    from app_private.tokyo_merchant_family_catalogue
    where entity_key=merchant_key and status='active'
    order by priority, family_id limit 1;

  if tg_table_name='merchant_acceptance_facts' then
    candidate_id := new.instrument_entity_id;
    if candidate_id is not null then
      select entity_key,display_name,entity_type into candidate_key,candidate_name,candidate_type
      from app_private.entities where id=candidate_id;
      if candidate_type in ('loyalty_program','qr_wallet','electronic_money','stored_value_program','credit_card','debit_card','prepaid_card','airline_program','hotel_program') then
        insert into app_private.ecosystem_family_backlog
          (entity_key,display_name,entity_type,first_discovered_merchant_family_id,first_source_url,discovery_origin)
        values
          (candidate_key,candidate_name,candidate_type,merchant_family,new.source_url,'merchant_research')
        on conflict(entity_key) do update set
          display_name=excluded.display_name,
          entity_type=excluded.entity_type,
          first_discovered_merchant_family_id=coalesce(app_private.ecosystem_family_backlog.first_discovered_merchant_family_id,excluded.first_discovered_merchant_family_id),
          first_source_url=coalesce(app_private.ecosystem_family_backlog.first_source_url,excluded.first_source_url),
          discovery_origin=case when app_private.ecosystem_family_backlog.discovery_origin='auto_entity_capture' then 'merchant_research' else app_private.ecosystem_family_backlog.discovery_origin end,
          agent_feed_status=case when app_private.ecosystem_family_backlog.existing_p0_family_id is null and app_private.ecosystem_family_backlog.agent_feed_status='pending' then 'ready' else app_private.ecosystem_family_backlog.agent_feed_status end,
          updated_at=now();
      end if;
    end if;
  elsif tg_table_name='merchant_tender_reward_facts' then
    foreach candidate_id in array array[new.loyalty_program_entity_id,new.payment_instrument_entity_id] loop
      if candidate_id is null then continue; end if;
      select entity_key,display_name,entity_type into candidate_key,candidate_name,candidate_type
      from app_private.entities where id=candidate_id;
      if candidate_type in ('loyalty_program','qr_wallet','electronic_money','stored_value_program','credit_card','debit_card','prepaid_card','airline_program','hotel_program') then
        insert into app_private.ecosystem_family_backlog
          (entity_key,display_name,entity_type,first_discovered_merchant_family_id,first_source_url,discovery_origin)
        values
          (candidate_key,candidate_name,candidate_type,merchant_family,new.source_url,'merchant_research')
        on conflict(entity_key) do update set
          display_name=excluded.display_name,
          entity_type=excluded.entity_type,
          first_discovered_merchant_family_id=coalesce(app_private.ecosystem_family_backlog.first_discovered_merchant_family_id,excluded.first_discovered_merchant_family_id),
          first_source_url=coalesce(app_private.ecosystem_family_backlog.first_source_url,excluded.first_source_url),
          discovery_origin=case when app_private.ecosystem_family_backlog.discovery_origin='auto_entity_capture' then 'merchant_research' else app_private.ecosystem_family_backlog.discovery_origin end,
          agent_feed_status=case when app_private.ecosystem_family_backlog.existing_p0_family_id is null and app_private.ecosystem_family_backlog.agent_feed_status='pending' then 'ready' else app_private.ecosystem_family_backlog.agent_feed_status end,
          updated_at=now();
      end if;
    end loop;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_capture_ecosystem_from_acceptance on app_private.merchant_acceptance_facts;
create trigger trg_capture_ecosystem_from_acceptance
after insert or update of instrument_entity_id,merchant_entity_id,source_url on app_private.merchant_acceptance_facts
for each row execute function app_private.capture_ecosystem_usage_from_merchant_fact();

drop trigger if exists trg_capture_ecosystem_from_reward on app_private.merchant_tender_reward_facts;
create trigger trg_capture_ecosystem_from_reward
after insert or update of loyalty_program_entity_id,payment_instrument_entity_id,merchant_entity_id,source_url on app_private.merchant_tender_reward_facts
for each row execute function app_private.capture_ecosystem_usage_from_merchant_fact();
