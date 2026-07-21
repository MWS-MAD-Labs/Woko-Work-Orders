create table if not exists organization_work_options (
  id uuid primary key default gen_random_uuid(),
  option_type text not null check (option_type in ('WORK_TYPE', 'CATEGORY', 'EXECUTION_WINDOW')),
  code text not null,
  label text not null,
  active boolean not null default true,
  sort_order integer not null default 0,
  removed_at timestamptz,
  updated_at timestamptz not null default now()
);

create unique index if not exists organization_work_options_type_code_idx
  on organization_work_options (option_type, code) where removed_at is null;

insert into organization_work_options (option_type, code, label, sort_order)
values
  ('WORK_TYPE', 'INTERNAL', 'Internal', 10),
  ('WORK_TYPE', 'VENDOR', 'Vendor', 20),
  ('CATEGORY', 'BUILDING_STRUCTURE', 'Building Structure', 10),
  ('CATEGORY', 'PAINTING', 'Painting', 20),
  ('CATEGORY', 'DOORS_AND_WINDOWS', 'Doors and Windows', 30),
  ('CATEGORY', 'ELECTRICAL', 'Electrical', 40),
  ('CATEGORY', 'PLUMBING', 'Plumbing', 50),
  ('CATEGORY', 'AIR_CONDITIONING', 'Air Conditioning', 60),
  ('CATEGORY', 'FURNITURE', 'Furniture', 70),
  ('CATEGORY', 'SAFETY_AND_SECURITY', 'Safety and Security', 80),
  ('CATEGORY', 'OUTDOOR_AREAS', 'Outdoor Areas', 90),
  ('CATEGORY', 'RENOVATION', 'Renovation', 100),
  ('CATEGORY', 'OTHER', 'Other', 110),
  ('EXECUTION_WINDOW', 'NO_RESTRICTION', 'No Restriction', 10),
  ('EXECUTION_WINDOW', 'AFTER_SCHOOL_HOURS', 'After School Hours', 20),
  ('EXECUTION_WINDOW', 'WEEKEND_ONLY', 'Weekend Only', 30),
  ('EXECUTION_WINDOW', 'SCHOOL_HOLIDAY_ONLY', 'School Holiday Only', 40),
  ('EXECUTION_WINDOW', 'REQUIRES_AREA_CLOSURE', 'Requires Area Closure', 50),
  ('EXECUTION_WINDOW', 'CUSTOM_RESTRICTION', 'Custom Restriction', 60)
on conflict do nothing;
