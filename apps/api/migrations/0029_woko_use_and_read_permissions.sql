-- Access Standard AS-3: everyone who can sign in gets `woko.use`, and each `manage` permission gets its `read`.
-- Whoever holds a `manage` already saw what `read` shows, so nothing changes for them.
insert into user_permissions (user_id, permission)
select id, 'woko.use' from users
on conflict do nothing;

insert into user_permissions (user_id, permission)
select user_id, replace(permission, '.manage', '.read')
from user_permissions
where permission in ('users.manage', 'settings.manage', 'work-list.manage', 'facilities.manage')
on conflict do nothing;
