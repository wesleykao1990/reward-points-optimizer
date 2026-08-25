\set ON_ERROR_STOP on

begin;

do $moppy_jal_standard_route$
declare
    v_rows integer;
    v_value jsonb;
begin
    select count(*)
      into v_rows
      from app_private.p0_route_graph_facts_at(
          timestamptz '2026-08-25T20:40:00+09:00'
      )
     where claim_id = 'claim.route.moppy.jal.standard.001'
       and research_artifact_id = 'p0-moppy-jal-standard.research.v0.1'
       and implementation_version = 'p0-moppy-jal-standard.implementation.v0.8';

    if v_rows <> 1 then
        raise exception 'Moppy to JAL standard route fact was not projected exactly once';
    end if;

    select value
      into strict v_value
      from app_private.p0_route_graph_facts_at(
          timestamptz '2026-08-25T20:40:00+09:00'
      )
     where claim_id = 'claim.route.moppy.jal.standard.001'
       and research_artifact_id = 'p0-moppy-jal-standard.research.v0.1'
       and implementation_version = 'p0-moppy-jal-standard.implementation.v0.8';

    if v_value #>> '{transfer,route_id}' is distinct from 'moppy-to-jal-standard'
       or v_value #>> '{transfer,source_asset_ref}' is distinct from 'asset.point.moppy'
       or v_value #>> '{transfer,destination_asset_ref}' is distinct from 'asset.mile.jal'
       or v_value #>> '{transfer,source_units}' is distinct from '1000'
       or v_value #>> '{transfer,destination_units}' is distinct from '500'
       or v_value #>> '{transfer,minimum_source_units}' is distinct from '1000'
       or v_value #>> '{transfer,increment_source_units}' is distinct from '1000'
       or v_value #>> '{transfer,fee_source_units}' is distinct from '0' then
        raise exception 'Moppy to JAL standard route economic tuple drifted: %', v_value;
    end if;
end
$moppy_jal_standard_route$;

rollback;
