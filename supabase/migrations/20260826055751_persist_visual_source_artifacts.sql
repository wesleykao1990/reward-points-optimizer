create table if not exists app_private.visual_source_artifacts (
  source_sha256 text primary key,
  source_kind text not null,
  mime_type text not null,
  byte_size bigint not null,
  width integer null,
  height integer null,
  official_page_url text null,
  official_image_url text null,
  content bytea not null,
  first_fetched_at timestamptz not null default now(),
  last_verified_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint visual_source_artifacts_sha256_check check (source_sha256 ~ '^[0-9a-f]{64}$'),
  constraint visual_source_artifacts_byte_size_check check (byte_size >= 0),
  constraint visual_source_artifacts_dimensions_check check ((width is null and height is null) or (width > 0 and height > 0))
);

create table if not exists app_private.entity_visual_source_links (
  asset_id text primary key,
  entity_id uuid null references app_private.entities(id) on delete set null,
  alias_of text null,
  source_sha256 text not null references app_private.visual_source_artifacts(source_sha256) on delete restrict,
  source_role text not null default 'primary',
  selected_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint entity_visual_source_links_asset_id_check check (asset_id ~ '^[a-z0-9][a-z0-9._-]+$'),
  constraint entity_visual_source_links_source_role_check check (source_role in ('primary','fallback','historical'))
);

create index if not exists entity_visual_source_links_source_sha_idx on app_private.entity_visual_source_links(source_sha256);
create index if not exists entity_visual_source_links_entity_id_idx on app_private.entity_visual_source_links(entity_id);

create or replace function app_private.touch_visual_source_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists visual_source_artifacts_touch_updated_at on app_private.visual_source_artifacts;
create trigger visual_source_artifacts_touch_updated_at
before update on app_private.visual_source_artifacts
for each row execute function app_private.touch_visual_source_updated_at();

drop trigger if exists entity_visual_source_links_touch_updated_at on app_private.entity_visual_source_links;
create trigger entity_visual_source_links_touch_updated_at
before update on app_private.entity_visual_source_links
for each row execute function app_private.touch_visual_source_updated_at();

alter table app_private.entity_visual_assets drop constraint if exists entity_visual_assets_source_sha256_fkey;
alter table app_private.entity_visual_assets
  add constraint entity_visual_assets_source_sha256_fkey
  foreign key (source_sha256)
  references app_private.visual_source_artifacts(source_sha256)
  on delete restrict
  not valid;

create or replace view app_api.visual_source_catalogue
with (security_barrier = true)
as
select
  l.asset_id,
  e.entity_key,
  l.alias_of,
  l.source_role,
  a.source_sha256,
  a.source_kind,
  a.mime_type,
  a.byte_size,
  a.width,
  a.height,
  a.official_page_url,
  a.official_image_url,
  a.first_fetched_at,
  a.last_verified_at,
  l.selected_at,
  l.updated_at
from app_private.entity_visual_source_links l
join app_private.visual_source_artifacts a on a.source_sha256 = l.source_sha256
left join app_private.entities e on e.id = l.entity_id;

revoke all on app_private.visual_source_artifacts from public, anon, authenticated;
revoke all on app_private.entity_visual_source_links from public, anon, authenticated;
revoke all on app_api.visual_source_catalogue from public, anon, authenticated;
grant select, insert, update, delete on app_private.visual_source_artifacts to jro_runtime;
grant select, insert, update, delete on app_private.entity_visual_source_links to jro_runtime;
grant select on app_api.visual_source_catalogue to jro_runtime;
