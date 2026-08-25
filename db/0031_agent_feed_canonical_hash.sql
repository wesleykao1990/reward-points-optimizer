-- Canonical JSON + SHA-256 helpers compatible with Agent Feed v0.1 payload hashing.
-- Kept separate so pgcrypto schema qualification can be verified independently.

begin;

create or replace function agent_feed.canonical_json_v01(p_value jsonb)
returns text
language plpgsql
immutable
strict
set search_path = pg_catalog, agent_feed
as $$
declare
    v_result text;
begin
    case jsonb_typeof(p_value)
        when 'null' then return 'null';
        when 'boolean' then return p_value::text;
        when 'number' then return trim_scale((p_value #>> '{}')::numeric)::text;
        when 'string' then return to_jsonb(p_value #>> '{}')::text;
        when 'array' then
            select '[' || coalesce(
                string_agg(
                    agent_feed.canonical_json_v01(item.value),
                    ',' order by item.ordinality
                ),
                ''
            ) || ']'
              into v_result
              from jsonb_array_elements(p_value)
                   with ordinality as item(value, ordinality);
            return v_result;
        when 'object' then
            select '{' || coalesce(
                string_agg(
                    to_jsonb(item.key)::text || ':' ||
                    agent_feed.canonical_json_v01(item.value),
                    ',' order by item.key collate "C"
                ),
                ''
            ) || '}'
              into v_result
              from jsonb_each(p_value) as item(key, value);
            return v_result;
        else
            raise exception 'Unsupported JSON value' using errcode = '22023';
    end case;
end;
$$;

create or replace function agent_feed.payload_hash_v01(p_value jsonb)
returns text
language sql
immutable
strict
set search_path = pg_catalog, agent_feed
as $$
    select encode(
        extensions.digest(
            convert_to(agent_feed.canonical_json_v01(p_value), 'UTF8'),
            'sha256'
        ),
        'hex'
    )
$$;

revoke all on function agent_feed.canonical_json_v01(jsonb) from public;
revoke all on function agent_feed.payload_hash_v01(jsonb) from public;

comment on function agent_feed.canonical_json_v01(jsonb) is
    'Agent Feed v0.1 canonical JSON helper: object keys sort in C/Unicode code-unit-compatible order and arrays retain order.';
comment on function agent_feed.payload_hash_v01(jsonb) is
    'Agent Feed v0.1 canonical JSON SHA-256 payload hash, returned as lowercase hex without a prefix.';

commit;
