create table if not exists app_private.entity_visual_assets (
  asset_id text primary key,
  entity_id uuid null references app_private.entities(id) on delete set null,
  alias_of text null,
  display_name text not null,
  entity_type text not null,
  asset_variant text not null default 'liquid_glass',
  format text not null default 'svg',
  mime_type text not null default 'image/svg+xml',
  width numeric(10,2) not null default 856,
  height numeric(10,2) not null default 539.8,
  aspect_ratio text not null default '85.60:53.98',
  svg_text text not null,
  svg_sha256 text not null,
  generation_run_id text not null,
  source_kind text null,
  source_page_url text null,
  source_image_url text null,
  source_sha256 text null,
  source_asset_path text null,
  source_mime text null,
  source_dimensions jsonb null,
  validation_status text not null default 'generated',
  validation_errors jsonb not null default '[]'::jsonb,
  generated_at timestamptz not null default now(),
  validated_at timestamptz null,
  deployed_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint entity_visual_assets_asset_id_check check (asset_id ~ '^[a-z0-9][a-z0-9._-]+$'),
  constraint entity_visual_assets_asset_variant_check check (asset_variant in ('liquid_glass')),
  constraint entity_visual_assets_format_check check (format in ('svg')),
  constraint entity_visual_assets_validation_status_check check (validation_status in ('generated','valid','invalid','deployed','retired')),
  constraint entity_visual_assets_sha256_check check (svg_sha256 ~ '^[0-9a-f]{64}$')
);

create index if not exists entity_visual_assets_entity_id_idx on app_private.entity_visual_assets(entity_id);
create index if not exists entity_visual_assets_alias_of_idx on app_private.entity_visual_assets(alias_of);
create index if not exists entity_visual_assets_generation_run_idx on app_private.entity_visual_assets(generation_run_id);
create index if not exists entity_visual_assets_validation_status_idx on app_private.entity_visual_assets(validation_status);

create or replace function app_private.touch_entity_visual_assets_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists entity_visual_assets_touch_updated_at on app_private.entity_visual_assets;
create trigger entity_visual_assets_touch_updated_at
before update on app_private.entity_visual_assets
for each row execute function app_private.touch_entity_visual_assets_updated_at();

create or replace view app_api.visual_asset_catalogue
with (security_barrier = true)
as
select
  va.asset_id,
  e.entity_key,
  va.alias_of,
  va.display_name,
  va.entity_type,
  va.asset_variant,
  va.format,
  va.mime_type,
  va.width,
  va.height,
  va.aspect_ratio,
  va.svg_sha256,
  va.generation_run_id,
  va.source_kind,
  va.source_page_url,
  va.source_image_url,
  va.source_sha256,
  va.validation_status,
  va.generated_at,
  va.validated_at,
  va.deployed_at,
  va.updated_at
from app_private.entity_visual_assets va
left join app_private.entities e on e.id = va.entity_id
where va.validation_status <> 'retired';

revoke all on app_private.entity_visual_assets from public, anon, authenticated;
revoke all on app_api.visual_asset_catalogue from public, anon, authenticated;
grant select on app_api.visual_asset_catalogue to jro_runtime;
grant select, insert, update, delete on app_private.entity_visual_assets to jro_runtime;
