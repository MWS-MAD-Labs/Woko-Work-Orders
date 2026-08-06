do $$ begin
  create type work_list_recurrence as enum ('DAILY', 'WEEKLY', 'MONTHLY');
exception when duplicate_object then null; end $$;
do $$ begin
  create type work_list_occurrence_status as enum ('OPEN', 'OVERDUE', 'SUBMITTED', 'SUBMITTED_LATE');
exception when duplicate_object then null; end $$;
do $$ begin
  create type work_list_item_status as enum ('COMPLETED', 'NOT_APPLICABLE', 'ISSUE_FOUND');
exception when duplicate_object then null; end $$;

create table if not exists work_list_templates (
  id uuid primary key default gen_random_uuid(), title text not null check (char_length(title) between 3 and 200),
  instructions text not null default '', active boolean not null default true, version integer not null default 1 check (version > 0),
  created_by uuid not null references users(id), updated_by uuid not null references users(id),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table if not exists work_list_template_items (
  id uuid primary key default gen_random_uuid(), template_id uuid not null references work_list_templates(id) on delete cascade,
  title text not null check (char_length(title) between 2 and 300), instructions text not null default '', recurrence work_list_recurrence not null,
  required boolean not null default true, sort_order integer not null check (sort_order >= 0),
  unique(template_id, sort_order)
);
create table if not exists work_list_template_locations (
  template_id uuid not null references work_list_templates(id) on delete cascade,
  location_option_id uuid not null references location_options(id), primary key(template_id, location_option_id)
);
create table if not exists work_list_template_workers (
  template_id uuid not null references work_list_templates(id) on delete cascade,
  user_id uuid not null references users(id), primary key(template_id, user_id)
);
create table if not exists work_list_occurrences (
  id uuid primary key default gen_random_uuid(), template_id uuid not null references work_list_templates(id), template_version integer not null,
  recurrence work_list_recurrence not null, period_date date not null, due_at timestamptz not null,
  status work_list_occurrence_status not null default 'OPEN', location_option_id uuid not null references location_options(id),
  location_snapshot jsonb not null, template_snapshot jsonb not null, worker_ids uuid[] not null,
  overall_note text, submitted_at timestamptz, submitted_by uuid references users(id), version integer not null default 1 check(version > 0),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique(template_id, template_version, location_option_id, recurrence, period_date)
);
create index if not exists work_list_occurrences_scope_idx on work_list_occurrences(status, due_at desc);
create index if not exists work_list_occurrences_workers_idx on work_list_occurrences using gin(worker_ids);
create table if not exists work_list_occurrence_items (
  id uuid primary key default gen_random_uuid(), occurrence_id uuid not null references work_list_occurrences(id) on delete cascade,
  template_item_id uuid not null, title text not null, instructions text not null default '', required boolean not null, sort_order integer not null,
  status work_list_item_status, note text, resolved_by uuid references users(id), resolved_at timestamptz,
  unique(occurrence_id, template_item_id)
);
create table if not exists work_list_evidence (
  id uuid primary key default gen_random_uuid(), occurrence_id uuid not null references work_list_occurrences(id) on delete cascade,
  drive_file_id text not null, drive_url text not null, file_name text not null, original_file_name text not null,
  mime_type text not null, file_size integer not null, uploaded_by uuid not null references users(id), created_at timestamptz not null default now()
);
create table if not exists work_list_audit_events (
  id uuid primary key default gen_random_uuid(), occurrence_id uuid references work_list_occurrences(id) on delete cascade,
  template_id uuid references work_list_templates(id) on delete set null, user_id uuid references users(id), event_type text not null,
  data jsonb not null default '{}'::jsonb, created_at timestamptz not null default now()
);
