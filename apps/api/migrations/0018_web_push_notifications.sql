create table if not exists push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists push_subscriptions_user_idx on push_subscriptions (user_id);

create or replace function enqueue_notification_push() returns trigger as $$
begin
  insert into background_jobs (job_type, payload, idempotency_key)
  values ('NOTIFICATION_PUSH', jsonb_build_object('notificationId', new.id), 'notification-push:' || new.id::text)
  on conflict (idempotency_key) do nothing;
  return new;
end;
$$ language plpgsql;

drop trigger if exists notifications_enqueue_push on notifications;
create trigger notifications_enqueue_push
after insert on notifications
for each row execute function enqueue_notification_push();
