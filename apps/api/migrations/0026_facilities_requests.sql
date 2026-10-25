do $$ begin
  create type facilities_request_status as enum ('PENDING', 'APPROVED', 'REJECTED', 'CANCELLED', 'RETURNED');
exception when duplicate_object then null; end $$;

do $$ begin
  create type facilities_return_condition as enum ('GOOD', 'DAMAGED', 'MISSING');
exception when duplicate_object then null; end $$;

-- The work-order settings singleton owns the organization-wide default manager.
create table if not exists work_order_settings (
  id boolean primary key default true check (id),
  default_facilities_manager_id uuid references users(id),
  updated_at timestamptz not null default now()
);

create table if not exists facilities_assets (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(btrim(name)) > 0),
  asset_code text not null unique check (length(btrim(asset_code)) > 0),
  quantity integer not null check (quantity >= 0),
  active boolean not null default true,
  created_by uuid not null references users(id),
  updated_by uuid not null references users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists facilities_requests (
  id uuid primary key default gen_random_uuid(),
  purpose text not null check (length(btrim(purpose)) > 0),
  location text not null check (length(btrim(location)) > 0),
  starts_at timestamptz not null,
  ends_at timestamptz not null check (ends_at > starts_at),
  status facilities_request_status not null default 'PENDING',
  requester_id uuid not null references users(id),
  approver_id uuid not null references users(id),
  decision_note text,
  decided_at timestamptz,
  cancelled_at timestamptz,
  return_note text,
  returned_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((status in ('PENDING', 'APPROVED', 'REJECTED', 'CANCELLED', 'RETURNED'))),
  check (status not in ('APPROVED', 'REJECTED') or decided_at is not null),
  check (status <> 'RETURNED' or returned_at is not null)
);

create table if not exists facilities_request_items (
  request_id uuid not null references facilities_requests(id) on delete cascade,
  asset_id uuid not null references facilities_assets(id),
  quantity integer not null check (quantity > 0),
  returned_quantity integer check (returned_quantity >= 0 and returned_quantity <= quantity),
  return_condition facilities_return_condition,
  issue_note text,
  inspected_by uuid references users(id),
  inspected_at timestamptz,
  issue_resolved_at timestamptz,
  issue_resolved_by uuid references users(id),
  issue_resolution_note text,
  primary key (request_id, asset_id),
  check ((returned_quantity is null) = (return_condition is null)),
  check ((return_condition not in ('DAMAGED', 'MISSING')) or issue_note is not null),
  check ((issue_resolved_at is null and issue_resolved_by is null and issue_resolution_note is null) or (return_condition in ('DAMAGED', 'MISSING') and issue_resolved_at is not null and issue_resolved_by is not null and issue_resolution_note is not null))
);

create table if not exists facilities_audit_events (
  id uuid primary key default gen_random_uuid(),
  request_id uuid references facilities_requests(id),
  asset_id uuid references facilities_assets(id),
  user_id uuid references users(id),
  event_type text not null,
  previous_data jsonb,
  new_data jsonb,
  correlation_id text,
  created_at timestamptz not null default now()
);

create index if not exists facilities_requests_requester_idx on facilities_requests (requester_id, starts_at desc);
create index if not exists facilities_requests_approver_idx on facilities_requests (approver_id, status, starts_at);
create index if not exists facilities_request_items_asset_idx on facilities_request_items (asset_id, request_id);
create index if not exists facilities_audit_events_request_idx on facilities_audit_events (request_id, created_at desc);

create or replace function prevent_facilities_audit_mutation() returns trigger as $$
begin
  raise exception 'Facilities audit events are immutable';
end;
$$ language plpgsql;

drop trigger if exists facilities_audit_events_immutable on facilities_audit_events;
create trigger facilities_audit_events_immutable before update or delete on facilities_audit_events
for each row execute function prevent_facilities_audit_mutation();