alter type app_role add value if not exists 'WORKER';

do $$ begin
  create type internal_procurement_status as enum (
    'NOT_REQUIRED', 'PROPOSAL_REQUIRED', 'SUBMITTED', 'APPROVED',
    'REJECTED', 'REVISION_REQUIRED'
  );
exception when duplicate_object then null; end $$;

create table if not exists work_order_workers (
  work_order_id uuid not null references work_orders(id) on delete cascade,
  user_id uuid not null references users(id),
  added_by uuid not null references users(id),
  added_at timestamptz not null default now(),
  primary key (work_order_id, user_id)
);

create index if not exists work_order_workers_user_idx
  on work_order_workers (user_id, work_order_id);

create table if not exists internal_procurement_proposals (
  work_order_id uuid primary key references work_orders(id) on delete cascade,
  status internal_procurement_status not null default 'NOT_REQUIRED',
  requirement_note text,
  submitted_by uuid references users(id),
  submitted_at timestamptz,
  decided_by uuid references users(id),
  decided_at timestamptz,
  decision_note text,
  version integer not null default 1 check (version > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into internal_procurement_proposals (work_order_id)
select id from work_orders where work_type = 'INTERNAL'
on conflict (work_order_id) do nothing;

alter table attachments
  add column if not exists status text not null default 'ATTACHED',
  add column if not exists pending_action_token uuid,
  add column if not exists attachment_context text,
  add column if not exists attached_at timestamptz;

update attachments
set attachment_context = case evidence_type
  when 'INITIAL' then 'INITIAL'
  when 'PROGRESS' then 'PROGRESS_UPDATE'
  when 'PROPOSAL' then case
    when exists (select 1 from work_orders wo where wo.id = attachments.work_order_id and wo.work_type = 'INTERNAL')
      then 'INTERNAL_PROCUREMENT'
    else 'VENDOR_PROPOSAL'
  end
  when 'COMPLETION' then 'COMPLETION'
end,
attached_at = coalesce(attached_at, created_at)
where attachment_context is null;

alter table attachments drop constraint if exists attachments_status_check;
alter table attachments add constraint attachments_status_check
  check (status in ('PENDING', 'ATTACHED'));
alter table attachments drop constraint if exists attachments_context_check;
alter table attachments add constraint attachments_context_check
  check (attachment_context in ('INITIAL', 'PROGRESS_UPDATE', 'VENDOR_PROPOSAL', 'INTERNAL_PROCUREMENT', 'COMPLETION'));

create unique index if not exists attachments_pending_token_idx
  on attachments (pending_action_token) where pending_action_token is not null;
create index if not exists attachments_pending_cleanup_idx
  on attachments (created_at) where status = 'PENDING' and removed_at is null;

create table if not exists work_order_drive_permissions (
  work_order_id uuid not null references work_orders(id) on delete cascade,
  user_id uuid not null references users(id),
  email citext not null,
  permission_id text,
  access_role text not null default 'reader',
  sync_status text not null default 'PENDING',
  last_error text,
  updated_at timestamptz not null default now(),
  primary key (work_order_id, user_id),
  check (access_role in ('reader')),
  check (sync_status in ('PENDING', 'COMPLETE', 'FAILED', 'REMOVED'))
);

create index if not exists work_order_drive_permissions_status_idx
  on work_order_drive_permissions (sync_status, updated_at);
