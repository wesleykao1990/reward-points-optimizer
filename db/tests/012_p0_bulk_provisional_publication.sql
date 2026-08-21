begin;

do $$
declare
    v_candidate jsonb;
    v_batch jsonb;
    v_bad jsonb;
    v_batches_before integer;
    v_members_before integer;
    v_rules_before integer;
    v_versions_before integer;
begin
    select count(*) into v_rules_before from app_private.reward_rules;
    select count(*) into v_versions_before from app_private.reward_rule_versions;
    select count(*) into v_batches_before
      from app_private.provisional_publication_batches;
    select count(*) into v_members_before
      from app_private.provisional_publication_batch_members;
    select candidate_payload into strict v_candidate
      from app_private.provisional_rule_candidates
     where candidate_hash = 'sha256:f931acf332c5432cca86af671798fe321353d11e49490d61e45b4df458e250bb';

    v_batch := jsonb_build_object(
        'version', 'provisional-publication-batch.v1',
        'batch_id', 'batch_jp_cvs_002_20260821',
        'plan_sha256', 'sha256:a59447525cb207838439a3cdb8b9cc22d19d875a650a64f50354137a78892003',
        'published_at', '2026-08-21T00:04:00Z',
        'batch_hash', 'sha256:a4cc73374b5638e709754e8e46b8a556c0e69f0d370efdefa5d38f854fab4236',
        'members', jsonb_build_array(jsonb_build_object(
            'member_id', 'jp_cvs_002_credit_card',
            'candidate_hash', 'sha256:f931acf332c5432cca86af671798fe321353d11e49490d61e45b4df458e250bb',
            'definition_hash', 'sha256:ebea92cf5859e2450aef073d14d19b008cfb2e1cf3cfa7030e5e46a194cb8038',
            'candidate_payload', v_candidate
        ))
    );

    if app_private.publish_provisional_candidate_batch(v_batch) <> 1 then
        raise exception 'bulk publication did not return one exact member';
    end if;
    if (select count(*) from app_private.provisional_publication_batches)
         <> v_batches_before + 1
       or (select count(*) from app_private.provisional_publication_batch_members)
         <> v_members_before + 1
    then
        raise exception 'bulk publication did not persist one atomic ledger entry';
    end if;
    if (select count(*) from app_api.active_experimental_provisional_publications
         where batch_id = 'batch_jp_cvs_002_20260821') <> 1 then
        raise exception 'active publication projection is missing the exact member';
    end if;

    -- Exact replay is idempotent and never appends a second ledger member.
    if app_private.publish_provisional_candidate_batch(v_batch) <> 1
       or (select count(*) from app_private.provisional_publication_batches)
            <> v_batches_before + 1
       or (select count(*) from app_private.provisional_publication_batch_members)
            <> v_members_before + 1
    then
        raise exception 'exact publication replay was not idempotent';
    end if;

    begin
        perform app_private.publish_provisional_candidate_batch(
            jsonb_set(
                v_batch,
                '{batch_hash}',
                to_jsonb('sha256:' || repeat('0', 64))
            )
        );
        raise exception 'changed content reused an existing batch ID';
    exception when sqlstate '55000' then
        null;
    end;

    -- A malformed final member rejects before any candidate or ledger write.
    v_bad := jsonb_set(v_batch, '{batch_id}', '"batch_malformed_20260821"'::jsonb);
    v_bad := jsonb_set(v_bad, '{batch_hash}', to_jsonb('sha256:' || repeat('1', 64)));
    v_bad := jsonb_set(
        v_bad,
        '{members}',
        (v_bad->'members') || jsonb_build_array(jsonb_build_object(
            'member_id', 'malformed_member',
            'candidate_hash', 'sha256:' || repeat('2', 64)
        ))
    );
    begin
        perform app_private.publish_provisional_candidate_batch(v_bad);
        raise exception 'malformed final member was accepted';
    exception when sqlstate '22023' then
        null;
    end;
    if exists (
        select 1 from app_private.provisional_publication_batches
         where batch_id = 'batch_malformed_20260821'
    ) then
        raise exception 'malformed batch left a partial ledger write';
    end if;

    -- A role that exists in the plan but is not explicitly experimental is denied.
    v_bad := jsonb_set(v_batch, '{batch_id}', '"batch_ineligible_20260821"'::jsonb);
    v_bad := jsonb_set(v_bad, '{batch_hash}', to_jsonb('sha256:' || repeat('3', 64)));
    v_bad := jsonb_set(
        v_bad,
        '{members,0,candidate_payload,source_role_id}',
        '"merchant_profile"'::jsonb
    );
    begin
        perform app_private.publish_provisional_candidate_batch(v_bad);
        raise exception 'non-experimental P0 role was published';
    exception when sqlstate '55000' then
        null;
    end;
    if exists (
        select 1 from app_private.provisional_publication_batches
         where batch_id = 'batch_ineligible_20260821'
    ) then
        raise exception 'ineligible role left a partial ledger write';
    end if;

    -- The trusted adapter projection is canonical candidate-hash order.
    v_bad := jsonb_set(v_batch, '{batch_id}', '"batch_unsorted_20260821"'::jsonb);
    v_bad := jsonb_set(v_bad, '{batch_hash}', to_jsonb('sha256:' || repeat('5', 64)));
    v_bad := jsonb_set(
        v_bad,
        '{members}',
        jsonb_build_array(
            jsonb_build_object(
                'member_id', 'unsorted_high',
                'candidate_hash', 'sha256:' || repeat('9', 64),
                'definition_hash', 'sha256:ebea92cf5859e2450aef073d14d19b008cfb2e1cf3cfa7030e5e46a194cb8038',
                'candidate_payload', jsonb_set(v_candidate, '{candidate_id}', '"candidate_unsorted_high"'::jsonb)
            ),
            jsonb_build_object(
                'member_id', 'unsorted_low',
                'candidate_hash', 'sha256:' || repeat('8', 64),
                'definition_hash', 'sha256:ebea92cf5859e2450aef073d14d19b008cfb2e1cf3cfa7030e5e46a194cb8038',
                'candidate_payload', jsonb_set(v_candidate, '{candidate_id}', '"candidate_unsorted_low"'::jsonb)
            )
        )
    );
    begin
        perform app_private.publish_provisional_candidate_batch(v_bad);
        raise exception 'unsorted publication projection was accepted';
    exception when sqlstate '22023' then
        null;
    end;

    -- Distinct hashes cannot reuse one caller-supplied candidate identity.
    v_bad := jsonb_set(v_batch, '{batch_id}', '"batch_duplicate_id_20260821"'::jsonb);
    v_bad := jsonb_set(v_bad, '{batch_hash}', to_jsonb('sha256:' || repeat('6', 64)));
    v_bad := jsonb_set(
        v_bad,
        '{members}',
        jsonb_build_array(
            jsonb_build_object(
                'member_id', 'duplicate_id_low',
                'candidate_hash', 'sha256:' || repeat('5', 64),
                'definition_hash', 'sha256:ebea92cf5859e2450aef073d14d19b008cfb2e1cf3cfa7030e5e46a194cb8038',
                'candidate_payload', v_candidate
            ),
            jsonb_build_object(
                'member_id', 'duplicate_id_high',
                'candidate_hash', 'sha256:' || repeat('6', 64),
                'definition_hash', 'sha256:ebea92cf5859e2450aef073d14d19b008cfb2e1cf3cfa7030e5e46a194cb8038',
                'candidate_payload', v_candidate
            )
        )
    );
    begin
        perform app_private.publish_provisional_candidate_batch(v_bad);
        raise exception 'duplicate candidate input identity was accepted';
    exception when sqlstate '22023' then
        null;
    end;
    if exists (
        select 1 from app_private.provisional_publication_batches
         where batch_id in ('batch_unsorted_20260821', 'batch_duplicate_id_20260821')
    ) then
        raise exception 'rejected identity/order batch left a partial write';
    end if;

    if (select count(*) from app_private.reward_rules) <> v_rules_before
       or (select count(*) from app_private.reward_rule_versions) <> v_versions_before
    then
        raise exception 'provisional batch mutated canonical rule tables';
    end if;
end
$$;

-- A credible correction removes the exact version from the active batch view;
-- the subtransaction rolls the correction back so later tests see the seed.
do $$
begin
    begin
        perform app_private.record_provisional_correction(
            jsonb_build_object(
                'version', 'provisional-correction.v1',
                'signal_id', 'p0_batch_view_removal',
                'candidate_hash', 'sha256:f931acf332c5432cca86af671798fe321353d11e49490d61e45b4df458e250bb',
                'category', 'not_accepted',
                'credible', true,
                'reported_at', '2026-08-21T00:05:00Z',
                'severity', 'normal'
            ),
            'sha256:' || repeat('4', 64)
        );
        if exists (
            select 1 from app_api.active_experimental_provisional_publications
             where batch_id = 'batch_jp_cvs_002_20260821'
        ) then
            raise exception 'disputed candidate remained in active publication view';
        end if;
        raise exception using errcode = 'P0B01', message = 'rollback expected correction';
    exception when sqlstate 'P0B01' then
        null;
    end;
    if (select count(*) from app_api.active_experimental_provisional_publications
         where batch_id = 'batch_jp_cvs_002_20260821') <> 1
       or exists (
           select 1 from app_private.provisional_correction_signals
            where signal_id = 'p0_batch_view_removal'
       )
    then
        raise exception 'correction rollback did not restore the active batch member';
    end if;
end
$$;

do $$
declare
    v_reloptions text[];
begin
    if has_function_privilege(
        'public',
        'app_private.publish_provisional_candidate_batch(jsonb)',
        'EXECUTE'
    ) then
        raise exception 'PUBLIC can execute the provisional batch adapter';
    end if;
    select reloptions into v_reloptions
      from pg_class
     where oid = 'app_api.active_experimental_provisional_publications'::regclass;
    if not ('security_invoker=true' = any(v_reloptions))
       or not ('security_barrier=true' = any(v_reloptions)) then
        raise exception 'active publication view is not invoker/barrier protected';
    end if;

    begin
        update app_private.provisional_publication_batches
           set published_at = published_at
         where batch_id = 'batch_jp_cvs_002_20260821';
        raise exception 'batch update was accepted';
    exception when sqlstate '55000' then
        null;
    end;
    begin
        delete from app_private.provisional_publication_batch_members
         where batch_id = 'batch_jp_cvs_002_20260821';
        raise exception 'batch member delete was accepted';
    exception when sqlstate '55000' then
        null;
    end;
    begin
        truncate table app_private.provisional_publication_batch_members;
        raise exception 'batch member truncate was accepted';
    exception when sqlstate '55000' then
        null;
    end;
end
$$;

rollback;
