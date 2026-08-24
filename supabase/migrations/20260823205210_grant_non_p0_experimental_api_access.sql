begin;
grant usage on schema app_api to anon, authenticated;
grant select on app_api.active_agent_feed_experimental_findings to anon, authenticated, jro_runtime;
commit;
