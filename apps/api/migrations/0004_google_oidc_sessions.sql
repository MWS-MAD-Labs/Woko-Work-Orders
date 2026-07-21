alter table users
  alter column google_subject_id drop not null;

update users set google_subject_id = null where google_subject_id like 'dev-%';

create table if not exists auth_login_attempts (
  state_hash text primary key,
  nonce_hash text not null,
  code_verifier text not null,
  redirect_path text not null default '/',
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

create table if not exists user_sessions (
  id uuid primary key default gen_random_uuid(),
  token_hash text unique not null,
  user_id uuid not null references users(id),
  expires_at timestamptz not null,
  last_seen_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  revoked_at timestamptz,
  user_agent text,
  ip_address inet
);

create index if not exists user_sessions_active_token_idx
  on user_sessions (token_hash, expires_at)
  where revoked_at is null;

create index if not exists user_sessions_user_idx
  on user_sessions (user_id, created_at desc);

create index if not exists auth_login_attempts_expiry_idx
  on auth_login_attempts (expires_at);
