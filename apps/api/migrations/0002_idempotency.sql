create table if not exists idempotency_keys (
  key text primary key,
  user_id uuid not null references users(id),
  request_path text not null,
  response_status integer not null,
  response_body jsonb not null,
  created_at timestamptz not null default now()
);

create index if not exists idempotency_keys_created_at_idx on idempotency_keys (created_at);
