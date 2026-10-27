-- Access is held as permissions per user. user_roles is no longer read; it stays for now so a rollback is possible.
create table if not exists user_permissions (
  user_id uuid not null references users(id) on delete cascade,
  permission text not null,
  granted_at timestamptz not null default now(),
  primary key (user_id, permission)
);

create index if not exists user_permissions_permission_idx on user_permissions (permission);

-- One-time copy of what each role used to allow. The lists are frozen here on purpose.
insert into user_permissions (user_id, permission)
select distinct ur.user_id, p.permission
from user_roles ur
join (
  values
    ('ADMINISTRATOR', 'work-order:create'), ('ADMINISTRATOR', 'work-order:read-all'), ('ADMINISTRATOR', 'work-order:operate-any'),
    ('ADMINISTRATOR', 'work-order:transition-any'), ('ADMINISTRATOR', 'work-order:approve'), ('ADMINISTRATOR', 'work-order:reopen'),
    ('ADMINISTRATOR', 'work-order:cancel'), ('ADMINISTRATOR', 'work-order:set-schedule'), ('ADMINISTRATOR', 'work-order:manage-participants'),
    ('ADMINISTRATOR', 'work-order:read-audit'), ('ADMINISTRATOR', 'work-order:be-reviewer'), ('ADMINISTRATOR', 'work-list:manage'),
    ('ADMINISTRATOR', 'facilities:manage'), ('ADMINISTRATOR', 'work-order:delete'), ('ADMINISTRATOR', 'settings:manage'),
    ('ADMINISTRATOR', 'users:manage'),
    ('FACILITIES_MANAGER', 'work-order:create'), ('FACILITIES_MANAGER', 'work-order:read-all'), ('FACILITIES_MANAGER', 'work-order:operate-any'),
    ('FACILITIES_MANAGER', 'work-order:transition-any'), ('FACILITIES_MANAGER', 'work-order:approve'), ('FACILITIES_MANAGER', 'work-order:reopen'),
    ('FACILITIES_MANAGER', 'work-order:cancel'), ('FACILITIES_MANAGER', 'work-order:set-schedule'), ('FACILITIES_MANAGER', 'work-order:manage-participants'),
    ('FACILITIES_MANAGER', 'work-order:read-audit'), ('FACILITIES_MANAGER', 'work-order:be-reviewer'), ('FACILITIES_MANAGER', 'work-list:manage'),
    ('FACILITIES_MANAGER', 'facilities:manage'), ('FACILITIES_MANAGER', 'work-list:receive-digest'), ('FACILITIES_MANAGER', 'facilities:default-approver'),
    ('PERSON_IN_CHARGE', 'work-order:create'), ('PERSON_IN_CHARGE', 'work-order:be-pic'),
    ('WORKER', 'work-order:be-worker'), ('WORKER', 'work-list:be-worker'),
    ('OVERSEER', 'work-order:be-overseer')
) as p(role, permission) on p.role = ur.role::text
on conflict do nothing;

-- Anyone could borrow equipment, so everyone keeps that.
insert into user_permissions (user_id, permission)
select id, 'facilities:request' from users
on conflict do nothing;
