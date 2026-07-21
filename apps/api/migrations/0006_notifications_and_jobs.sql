alter table notifications
  add column if not exists idempotency_key text,
  add column if not exists acknowledged_at timestamptz,
  add column if not exists email_attempts integer not null default 0,
  add column if not exists email_last_error text,
  add column if not exists email_sent_at timestamptz;

create unique index if not exists notifications_idempotency_key_idx
  on notifications (idempotency_key)
  where idempotency_key is not null;

create index if not exists notifications_recipient_created_idx
  on notifications (recipient_user_id, created_at desc);

create table if not exists background_jobs (
  id uuid primary key default gen_random_uuid(),
  job_type text not null,
  payload jsonb not null default '{}'::jsonb,
  idempotency_key text unique,
  status text not null default 'PENDING' check (status in ('PENDING', 'RUNNING', 'COMPLETED', 'FAILED')),
  attempts integer not null default 0,
  max_attempts integer not null default 5 check (max_attempts > 0),
  run_at timestamptz not null default now(),
  locked_at timestamptz,
  locked_by text,
  last_error text,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists background_jobs_ready_idx
  on background_jobs (run_at, created_at)
  where status = 'PENDING';

create or replace function enqueue_notification_email() returns trigger as $$
begin
  insert into background_jobs (job_type, payload, idempotency_key)
  values ('NOTIFICATION_EMAIL', jsonb_build_object('notificationId', new.id), 'notification-email:' || new.id::text)
  on conflict (idempotency_key) do nothing;
  return new;
end;
$$ language plpgsql;

drop trigger if exists notifications_enqueue_email on notifications;
create trigger notifications_enqueue_email
after insert on notifications
for each row execute function enqueue_notification_email();

insert into background_jobs (job_type, payload, idempotency_key)
select 'NOTIFICATION_EMAIL', jsonb_build_object('notificationId', n.id), 'notification-email:' || n.id::text
from notifications n
where n.email_status = 'PENDING'
on conflict (idempotency_key) do nothing;
