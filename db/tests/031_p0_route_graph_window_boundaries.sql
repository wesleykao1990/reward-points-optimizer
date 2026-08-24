\set ON_ERROR_STOP on

begin;

do $boundaries$
declare
    v_rows integer;
begin
    select count(*) into v_rows
      from app_private.p0_route_graph_facts_at(
          timestamptz '2026-08-25T00:00:00+09:00'
      )
     where claim_id in (
         'claim.route.revolut.ana-pay.001',
         'claim.route.prerequisite.revolut-ana-pay-card.001',
         'claim.route.prerequisite.mizuho-ana-existing.001'
     );
    if v_rows <> 3 then
        raise exception 'current complex route facts were not all projected';
    end if;

    select count(*) into v_rows
      from app_private.p0_route_graph_facts_at(
          timestamptz '2025-05-26T00:00:00+09:00'
      )
     where claim_id in (
         'claim.route.revolut.ana-pay.001',
         'claim.route.prerequisite.revolut-ana-pay-card.001',
         'claim.route.prerequisite.mizuho-ana-existing.001'
     );
    if v_rows <> 0 then
        raise exception 'complex route facts leaked before effective_from';
    end if;

    select count(*) into v_rows
      from app_private.p0_route_graph_facts_at(
          timestamptz '2026-01-20T00:00:00+09:00'
      )
     where claim_id = 'claim.route.prerequisite.mizuho-ana-existing.001';
    if v_rows <> 0 then
        raise exception 'Mizuho prerequisite leaked before effective_from';
    end if;

    select count(*) into v_rows
      from app_private.p0_route_graph_facts_at(
          timestamptz '2026-06-11T00:00:00+09:00'
      )
     where claim_id = 'claim.route.jal-mileage-park.amazon-suspended.001';
    if v_rows <> 1 then
        raise exception 'to-only route fact was hidden before effective_to';
    end if;

    select count(*) into v_rows
      from app_private.p0_route_graph_facts_at(
          timestamptz '2026-06-12T00:00:00+09:00'
      )
     where claim_id = 'claim.route.jal-mileage-park.amazon-suspended.001';
    if v_rows <> 0 then
        raise exception 'to-only route fact remained active at effective_to';
    end if;

    if app_private.p0_route_graph_window_active(
           'transfer_rule', 'insufficient_operation_mapping',
           '{"effective_from":"2026-02-30","effective_to":null,"timezone":"Asia/Tokyo"}'::jsonb,
           timestamptz '2026-08-25T00:00:00+09:00'
       ) then
        raise exception 'malformed route window was admitted';
    end if;
end
$boundaries$;

rollback;
