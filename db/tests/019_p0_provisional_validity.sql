\set ON_ERROR_STOP on

begin;

do $test$
declare
    v_candidate jsonb := jsonb_build_object(
        'rule', jsonb_build_object(
            'validity', jsonb_build_object(
                'valid_from', '2026-08-22T00:00:00+09:00',
                'valid_to', '2026-08-23T00:00:00+09:00'
            )
        )
    );
begin
    if app_private.provisional_rule_valid_at(
           v_candidate, '2026-08-21T23:59:59.999999+09:00'
       )
       or not app_private.provisional_rule_valid_at(
           v_candidate, '2026-08-22T00:00:00+09:00'
       )
       or not app_private.provisional_rule_valid_at(
           v_candidate, '2026-08-22T23:59:59.999999+09:00'
       )
       or app_private.provisional_rule_valid_at(
           v_candidate, '2026-08-23T00:00:00+09:00'
       )
    then
        raise exception 'provisional economic validity is not half-open';
    end if;

    if app_private.provisional_rule_valid_at(
           jsonb_set(
               v_candidate,
               '{rule,validity,valid_from}',
               '"2026-08-22"'::jsonb
           ),
           '2026-08-22T12:00:00+09:00'
       )
       or app_private.provisional_rule_valid_at(
           jsonb_set(
               v_candidate,
               '{rule,validity,valid_to}',
               '"not-a-date"'::jsonb
           ),
           '2026-08-22T12:00:00+09:00'
       )
       or app_private.provisional_rule_valid_at(
           v_candidate - 'rule',
           '2026-08-22T12:00:00+09:00'
       )
    then
        raise exception 'malformed provisional validity did not fail closed';
    end if;

    if not app_private.provisional_rule_valid_at(
        jsonb_set(v_candidate, '{rule,validity,valid_to}', 'null'::jsonb),
        '2036-08-22T12:00:00+09:00'
    ) then
        raise exception 'open-ended provisional validity was not retained';
    end if;
end;
$test$;

rollback;
