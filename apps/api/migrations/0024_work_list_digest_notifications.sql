update notifications
set type = 'WORK_LIST_MISSED_DIGEST',
    title = case when title = 'Work Lists marked as missed' then 'Historical missed Work Lists' else title end,
    message = regexp_replace(message, 'No worker action is required; this notice is for facilities monitoring only\.$', 'No worker action is required; this digest is for facilities monitoring only.'),
    acknowledged_at = coalesce(acknowledged_at, now())
where type = 'WORK_LIST_MISSED';

delete from notifications where type = 'WORK_LIST_OVERDUE';
