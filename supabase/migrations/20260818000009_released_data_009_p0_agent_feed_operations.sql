-- Staged from db/seeds/009_p0_agent_feed_operations.sql; edit the canonical source, not this file.
-- Register the exact 19-stream / 301-target P0 operations manifest.
begin;

select app_private.register_p0_agent_feed_operations(
    'sha256:a59447525cb207838439a3cdb8b9cc22d19d875a650a64f50354137a78892003',
    'sha256:6aa634b868e43f9c3f58417602e7b4465e36824f26d00bd9187f043395b4fae8'
);

do $$
begin
    if (select count(*) from app_private.p0_agent_feed_operation_manifests) <> 1
       or (select count(*) from app_private.p0_agent_feed_operation_targets) <> 301
       or (select count(distinct stream_id) from app_private.p0_agent_feed_operation_targets) <> 19 then
        raise exception 'P0 Agent Feed operation manifest seed drifted';
    end if;
end;
$$;

commit;
