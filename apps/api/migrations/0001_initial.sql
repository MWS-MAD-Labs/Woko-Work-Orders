create extension if not exists pgcrypto;
create extension if not exists citext;

do $$ begin
  create type app_role as enum ('ADMINISTRATOR', 'FACILITIES_MANAGER', 'PERSON_IN_CHARGE', 'VIEWER');
exception when duplicate_object then null; end $$;
do $$ begin
  create type work_type as enum ('INTERNAL', 'VENDOR');
exception when duplicate_object then null; end $$;
do $$ begin
  create type priority as enum ('CRITICAL', 'HIGH', 'NORMAL', 'LOW');
exception when duplicate_object then null; end $$;
do $$ begin
  create type task_condition as enum ('ON_TRACK', 'AT_RISK', 'BLOCKED');
exception when duplicate_object then null; end $$;
do $$ begin
  create type work_order_status as enum ('ACTIVE', 'COMPLETED', 'CANCELLED');
exception when duplicate_object then null; end $$;

create table if not exists users (
  id uuid primary key default gen_random_uuid(),
  google_subject_id text unique not null,
  email citext unique not null,
  full_name text not null,
  profile_photo_url text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_login_at timestamptz
);

create table if not exists user_roles (
  user_id uuid not null references users(id),
  role app_role not null,
  primary key (user_id, role)
);

create table if not exists campuses (
  id uuid primary key default gen_random_uuid(),
  code text unique not null,
  name text not null,
  active boolean not null default true
);

create table if not exists buildings (
  id uuid primary key default gen_random_uuid(),
  campus_id uuid not null references campuses(id),
  code text not null,
  name text not null,
  active boolean not null default true,
  unique (campus_id, code)
);

create table if not exists work_order_sequences (
  year integer primary key,
  last_value integer not null check (last_value > 0)
);

create table if not exists work_orders (
  id uuid primary key default gen_random_uuid(),
  work_order_number text unique not null,
  title text not null,
  description text not null,
  category text not null,
  campus_id uuid not null references campuses(id),
  building_id uuid not null references buildings(id),
  floor text,
  room_or_area text not null,
  location_note text,
  work_type work_type not null,
  priority priority not null default 'NORMAL',
  condition task_condition not null default 'ON_TRACK',
  workflow_stage text not null default 'PLANNED',
  planned_start_date date,
  due_date date not null,
  completion_date date,
  execution_window text not null default 'NO_RESTRICTION',
  execution_window_note text,
  estimated_cost numeric(14,2),
  primary_assignee_id uuid not null references users(id),
  reviewer_id uuid references users(id),
  created_by_id uuid not null references users(id),
  drive_folder_id text,
  drive_folder_url text,
  drive_provisioning_status text not null default 'PENDING' check (drive_provisioning_status in ('PENDING', 'PROVISIONING', 'COMPLETE', 'FAILED')),
  status work_order_status not null default 'ACTIVE',
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists work_order_collaborators (
  work_order_id uuid not null references work_orders(id),
  user_id uuid not null references users(id),
  added_by uuid not null references users(id),
  added_at timestamptz not null default now(),
  primary key (work_order_id, user_id)
);

create table if not exists progress_updates (
  id uuid primary key default gen_random_uuid(),
  work_order_id uuid not null references work_orders(id),
  update_type text not null,
  previous_stage text,
  new_stage text,
  note text not null,
  structured_data jsonb not null default '{}'::jsonb,
  created_by uuid not null references users(id),
  created_at timestamptz not null default now()
);

create table if not exists attachments (
  id uuid primary key default gen_random_uuid(),
  work_order_id uuid not null references work_orders(id),
  progress_update_id uuid references progress_updates(id),
  drive_file_id text,
  drive_url text not null,
  file_name text not null,
  mime_type text not null,
  file_size bigint,
  drive_subfolder_type text not null,
  uploaded_by uuid not null references users(id),
  created_at timestamptz not null default now(),
  removed_at timestamptz,
  removed_by uuid references users(id)
);

create table if not exists approvals (
  id uuid primary key default gen_random_uuid(),
  work_order_id uuid not null references work_orders(id),
  progress_update_id uuid not null references progress_updates(id),
  approval_type text not null,
  decision text not null,
  decision_note text not null,
  decided_by uuid not null references users(id),
  decided_at timestamptz not null default now()
);

create table if not exists audit_events (
  id uuid primary key default gen_random_uuid(),
  work_order_id uuid references work_orders(id),
  user_id uuid references users(id),
  event_type text not null,
  previous_data jsonb,
  new_data jsonb,
  reason text,
  correlation_id text,
  created_at timestamptz not null default now()
);

create table if not exists notifications (
  id uuid primary key default gen_random_uuid(),
  recipient_user_id uuid not null references users(id),
  work_order_id uuid references work_orders(id),
  type text not null,
  title text not null,
  message text not null,
  read_status boolean not null default false,
  email_status text not null default 'PENDING',
  created_at timestamptz not null default now(),
  read_at timestamptz
);

create table if not exists academic_periods (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  type text not null check (type in ('SEMESTER', 'ACADEMIC_YEAR')),
  start_date date not null,
  end_date date not null,
  academic_year_label text not null,
  active boolean not null default true,
  check (end_date >= start_date)
);

create index if not exists work_orders_active_due_idx on work_orders (status, due_date, priority);
create index if not exists work_orders_assignee_idx on work_orders (primary_assignee_id, status, due_date);
create index if not exists progress_updates_timeline_idx on progress_updates (work_order_id, created_at desc);
create index if not exists audit_events_work_order_idx on audit_events (work_order_id, created_at desc);

create or replace function prevent_audit_mutation() returns trigger as $$
begin
  raise exception 'Audit events are immutable';
end;
$$ language plpgsql;

drop trigger if exists audit_events_immutable on audit_events;
create trigger audit_events_immutable before update or delete on audit_events
for each row execute function prevent_audit_mutation();
