alter table buildings add column if not exists removed_at timestamptz;
alter table location_options add column if not exists removed_at timestamptz;

alter table buildings drop constraint if exists buildings_campus_id_code_key;
create unique index if not exists buildings_active_code_idx
  on buildings (campus_id, code) where removed_at is null;

drop index if exists location_options_unique_name_idx;
create unique index if not exists location_options_unique_name_idx
  on location_options (building_id, coalesce(parent_id, '00000000-0000-0000-0000-000000000000'::uuid), lower(name))
  where removed_at is null;
