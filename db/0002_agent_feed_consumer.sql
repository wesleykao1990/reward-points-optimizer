-- Rewards Optimizer: Agent Feed consumer staging tables.
-- This migration assumes db/0001_core_schema.sql has already been applied.
begin;

create table app_private.agent_feed_receipts (
    id uuid primary key default gen_random_uuid(),
    event_id text not null unique,
    protocol_version text not null check (protocol_version = '0.1'),
    stream_id text not null,
    run_id text not null,
    finding_id text,
    event_type text not null,
    received_at timestamptz not null default now(),
    payload_hash text not null check (payload_hash ~ '^sha256:[0-9a-f]{64}$'),
    raw_payload jsonb not null,
    processing_status text not null default 'received' check (processing_status in ('received','mapped','duplicate','quarantined','failed')),
    error_code text,
    redaction_status text not null default 'pending' check (redaction_status in ('pending','complete','rejected')),
    retention_class text not null default 'short_operational',
    purge_after timestamptz not null default (now() + interval '30 days'),
    created_at timestamptz not null default now(),
    check (processing_status not in ('mapped','duplicate') or redaction_status = 'complete')
);

create index agent_feed_receipts_run_idx on app_private.agent_feed_receipts (run_id, received_at desc);

create table app_private.source_observations (
    id uuid primary key default gen_random_uuid(),
    observation_key text not null unique check (observation_key ~ '^so_[a-z0-9_-]+$'),
    receipt_id uuid not null references app_private.agent_feed_receipts(id) on delete restrict,
    semantic_fingerprint_version integer not null default 1 check (semantic_fingerprint_version = 1),
    semantic_fingerprint text not null check (semantic_fingerprint ~ '^sha256:[0-9a-f]{64}$'),
    source_keys jsonb not null check (jsonb_typeof(source_keys) = 'array'),
    subjects jsonb not null check (jsonb_typeof(subjects) = 'array'),
    change_type text not null check (change_type in ('reward_rate','eligibility','campaign','cap','merchant_acceptance','funding_route','transfer','expiry','announcement','unknown')),
    summary text not null,
    effective_from timestamptz,
    effective_to timestamptz,
    discovery_assessment jsonb not null,
    raw_attributes jsonb not null default '{}'::jsonb,
    security_flags jsonb not null default '[]'::jsonb check (jsonb_typeof(security_flags) = 'array'),
    status text not null check (status in ('new','duplicate','needs_evidence','needs_review','rejected','closed')),
    retention_class text not null default 'review_work',
    purge_after timestamptz not null default (now() + interval '180 days'),
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    check (effective_to is null or effective_from is null or effective_to > effective_from)
);

create index source_observations_fingerprint_idx on app_private.source_observations (semantic_fingerprint, created_at desc);
create index source_observations_status_idx on app_private.source_observations (status, created_at);
create or replace function app_private.enforce_source_observation_transition()
returns trigger language plpgsql as $$
begin
    if new.status = old.status then
        return new;
    end if;
    if old.status = 'new' and new.status in ('duplicate','needs_evidence','needs_review','rejected','closed') then
        return new;
    elsif old.status = 'needs_evidence' and new.status in ('needs_review','rejected','closed') then
        return new;
    elsif old.status = 'needs_review' and new.status in ('rejected','closed') then
        return new;
    end if;
    raise exception 'invalid SourceObservation transition % -> %', old.status, new.status;
end
$$;

create trigger source_observations_enforce_transition
before update of status on app_private.source_observations
for each row execute function app_private.enforce_source_observation_transition();

create trigger source_observations_set_updated_at
before update on app_private.source_observations
for each row execute function app_private.set_updated_at();

create table app_private.source_observation_submitted_evidence (
    observation_id uuid not null references app_private.source_observations(id) on delete restrict,
    agent_feed_evidence_id text not null,
    submitted_payload jsonb not null,
    promotion_status text not null default 'unreviewed' check (promotion_status in ('unreviewed','lead_only','capture_required','promoted','rejected')),
    promoted_evidence_id uuid references app_private.evidence_records(id) on delete restrict,
    created_at timestamptz not null default now(),
    primary key (observation_id, agent_feed_evidence_id),
    check ((promotion_status = 'promoted') = (promoted_evidence_id is not null))
);

create table app_private.monitor_stream_expectations (
    stream_id text primary key,
    expected_cadence_seconds integer not null check (expected_cadence_seconds >= 3600),
    grace_seconds integer not null default 0 check (grace_seconds >= 0),
    enabled boolean not null default true,
    owner text not null,
    last_terminal_run_at timestamptz,
    next_due_at timestamptz,
    liveness_status text not null default 'never_seen' check (liveness_status in (
        'healthy','due','overdue','degraded','disabled','never_seen'
    )),
    updated_at timestamptz not null default now()
);

create table app_private.monitor_stream_sources (
    stream_id text not null references app_private.monitor_stream_expectations(stream_id) on delete cascade,
    source_id uuid not null references app_private.trusted_sources(id) on delete restrict,
    primary key (stream_id, source_id)
);

create table app_private.source_monitoring_freshness (
    source_id uuid primary key references app_private.trusted_sources(id) on delete restrict,
    freshness_status text not null check (freshness_status in ('healthy','stale','degraded','unknown')),
    reason_code text,
    stream_id text references app_private.monitor_stream_expectations(stream_id) on delete set null,
    updated_at timestamptz not null default now()
);

create table app_private.monitoring_incidents (
    id uuid primary key default gen_random_uuid(),
    stream_id text not null references app_private.monitor_stream_expectations(stream_id) on delete restrict,
    incident_type text not null check (incident_type in ('overdue_run','partial_run','failed_run','scope_degradation')),
    status text not null default 'open' check (status in ('open','acknowledged','resolved')),
    detected_at timestamptz not null default now(),
    expected_by timestamptz,
    resolved_at timestamptz,
    details jsonb not null default '{}'::jsonb,
    check (resolved_at is null or resolved_at >= detected_at)
);

create unique index monitoring_incidents_one_open_idx
    on app_private.monitoring_incidents (stream_id, incident_type)
    where status in ('open','acknowledged');

create or replace function app_private.record_monitor_terminal_run(
    p_stream_id text, p_completed_at timestamptz, p_status text
) returns void language plpgsql as $$
declare
    v_next_due timestamptz;
begin
    update app_private.monitor_stream_expectations
       set last_terminal_run_at = greatest(coalesce(last_terminal_run_at, p_completed_at), p_completed_at),
           next_due_at = p_completed_at + make_interval(secs => expected_cadence_seconds + grace_seconds),
           liveness_status = case when p_status = 'completed' then 'healthy' else 'degraded' end,
           updated_at = now()
     where stream_id = p_stream_id
     returning next_due_at into v_next_due;

    update app_private.source_monitoring_freshness f
       set freshness_status = case when p_status = 'completed' then 'healthy' else 'degraded' end,
           reason_code = case when p_status = 'completed' then null else 'agent_feed_' || p_status end,
           stream_id = p_stream_id,
           updated_at = now()
      from app_private.monitor_stream_sources m
     where m.stream_id = p_stream_id and f.source_id = m.source_id;

    update app_private.monitoring_incidents
       set status = 'resolved', resolved_at = now()
     where stream_id = p_stream_id and status in ('open','acknowledged')
       and incident_type = 'overdue_run';
end
$$;

create or replace function app_private.sweep_overdue_monitor_streams(p_now timestamptz default now())
returns integer language plpgsql as $$
declare v_count integer;
begin
    insert into app_private.monitoring_incidents (stream_id, incident_type, status, detected_at, expected_by)
    select e.stream_id, 'overdue_run', 'open', p_now, e.next_due_at
      from app_private.monitor_stream_expectations e
     where e.enabled
       and (e.next_due_at is null or p_now > e.next_due_at)
       and not exists (
           select 1 from app_private.monitoring_incidents i
            where i.stream_id = e.stream_id and i.incident_type = 'overdue_run'
              and i.status in ('open','acknowledged')
       );
    get diagnostics v_count = row_count;

    update app_private.monitor_stream_expectations
       set liveness_status = 'overdue', updated_at = p_now
     where enabled and (next_due_at is null or p_now > next_due_at);

    insert into app_private.source_monitoring_freshness (source_id, freshness_status, reason_code, stream_id, updated_at)
    select m.source_id, 'stale', 'agent_feed_overdue_run', m.stream_id, p_now
      from app_private.monitor_stream_sources m
      join app_private.monitor_stream_expectations e on e.stream_id = m.stream_id
     where e.liveness_status = 'overdue'
    on conflict (source_id) do update
       set freshness_status = excluded.freshness_status,
           reason_code = excluded.reason_code,
           stream_id = excluded.stream_id,
           updated_at = excluded.updated_at;
    return v_count;
end
$$;

create or replace function app_private.redact_expired_agent_feed_receipts(p_now timestamptz default now())
returns integer language plpgsql as $$
declare v_count integer;
begin
    update app_private.agent_feed_receipts
       set raw_payload = '{}'::jsonb, redaction_status = 'complete'
     where purge_after <= p_now
       and processing_status in ('mapped','duplicate','quarantined','failed');
    get diagnostics v_count = row_count;
    return v_count;
end
$$;

comment on table app_private.agent_feed_receipts is 'Idempotent transport receipts from the separate Agent Feed service.';
comment on table app_private.source_observations is 'Untrusted reward-domain observations mapped from generic findings; never a published rule.';
comment on table app_private.source_observation_submitted_evidence is 'Producer-supplied evidence pending consumer-specific canonical capture/promotion.';

revoke all on all tables in schema app_private from public;
commit;
