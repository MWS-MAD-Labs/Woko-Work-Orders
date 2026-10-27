-- Permission keys follow domain.action (Access Standard AS-3). Woko has not registered its keys with Central yet,
-- so the stored keys are renamed in place.
update user_permissions
set permission = replace(permission, ':', '.')
where permission like '%:%';
