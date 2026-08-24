-- Supabase-only dependency for the private merchant-address enrichment job.

create schema if not exists extensions;
create extension if not exists http with schema extensions;
create extension if not exists pgcrypto with schema extensions;

comment on extension http is
  'Server-side HTTP client used only by private, audited merchant-location enrichment jobs.';
