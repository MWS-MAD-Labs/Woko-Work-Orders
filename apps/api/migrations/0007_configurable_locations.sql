create table if not exists location_options (
  id uuid primary key default gen_random_uuid(),
  building_id uuid not null references buildings(id),
  parent_id uuid references location_options(id),
  type_label text not null,
  code text,
  name text not null,
  active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (building_id, parent_id, name)
);

create index if not exists location_options_building_parent_idx
  on location_options (building_id, parent_id, active, sort_order, name);

create unique index if not exists location_options_unique_name_idx
  on location_options (building_id, coalesce(parent_id, '00000000-0000-0000-0000-000000000000'::uuid), lower(name));

alter table work_orders
  add column if not exists location_option_id uuid references location_options(id);
