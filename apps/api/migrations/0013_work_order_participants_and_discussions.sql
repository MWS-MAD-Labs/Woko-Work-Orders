update user_roles set role = 'OVERSEER' where role = 'VIEWER';

create table if not exists work_order_assignees (
  work_order_id uuid not null references work_orders(id) on delete cascade,
  user_id uuid not null references users(id),
  added_by uuid not null references users(id),
  added_at timestamptz not null default now(),
  primary key (work_order_id, user_id)
);

create index if not exists work_order_assignees_user_idx
  on work_order_assignees (user_id, work_order_id);

insert into work_order_assignees (work_order_id, user_id, added_by)
select id, primary_assignee_id, created_by_id
from work_orders
on conflict (work_order_id, user_id) do nothing;

create table if not exists work_order_overseers (
  work_order_id uuid not null references work_orders(id) on delete cascade,
  user_id uuid not null references users(id),
  added_by uuid not null references users(id),
  added_at timestamptz not null default now(),
  primary key (work_order_id, user_id)
);

create index if not exists work_order_overseers_user_idx
  on work_order_overseers (user_id, work_order_id);

insert into work_order_overseers (work_order_id, user_id, added_by, added_at)
select work_order_id, user_id, added_by, added_at
from work_order_collaborators
on conflict (work_order_id, user_id) do nothing;

create table if not exists progress_update_comments (
  id uuid primary key default gen_random_uuid(),
  progress_update_id uuid not null references progress_updates(id) on delete cascade,
  work_order_id uuid not null references work_orders(id) on delete cascade,
  body text not null check (char_length(trim(body)) between 1 and 2000),
  created_by uuid not null references users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists progress_update_comments_thread_idx
  on progress_update_comments (progress_update_id, created_at);

create index if not exists progress_update_comments_participant_idx
  on progress_update_comments (work_order_id, created_by, created_at desc);
