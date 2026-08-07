create or replace function prevent_missed_work_list_occurrence_changes()
returns trigger language plpgsql as $$
begin
  if old.status = 'MISSED' then
    raise exception 'MISSED Work List occurrences are immutable';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end $$;

create or replace function prevent_missed_work_list_child_changes()
returns trigger language plpgsql as $$
begin
  if exists (
    select 1 from work_list_occurrences
    where status = 'MISSED'
      and id in (
        case when tg_op = 'INSERT' then new.occurrence_id else old.occurrence_id end,
        case when tg_op = 'DELETE' then old.occurrence_id else new.occurrence_id end
      )
  ) then
    raise exception 'MISSED Work List occurrences are immutable';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end $$;

drop trigger if exists protect_missed_work_list_occurrences on work_list_occurrences;
create trigger protect_missed_work_list_occurrences
before update or delete on work_list_occurrences
for each row execute function prevent_missed_work_list_occurrence_changes();

drop trigger if exists protect_missed_work_list_items on work_list_occurrence_items;
create trigger protect_missed_work_list_items
before insert or update or delete on work_list_occurrence_items
for each row execute function prevent_missed_work_list_child_changes();

drop trigger if exists protect_missed_work_list_evidence on work_list_evidence;
create trigger protect_missed_work_list_evidence
before insert or update or delete on work_list_evidence
for each row execute function prevent_missed_work_list_child_changes();

with converted as (
  update work_list_occurrences
  set status = 'MISSED', version = version + 1, updated_at = now()
  where status = 'OVERDUE'
  returning template_snapshot->>'title' as title, location_snapshot->>'name' as location
), summary as (
  select count(*)::int as count,
    (array_agg(title || ' · ' || location))[1:4] as examples
  from converted
)
insert into notifications (recipient_user_id, type, title, message, idempotency_key, acknowledged_at)
select distinct u.id, 'WORK_LIST_MISSED_DIGEST', 'Historical missed Work Lists',
  summary.count || ' Work List' || case when summary.count = 1 then '' else 's' end ||
    ' were converted from overdue to missed during deployment: ' || array_to_string(summary.examples, ', ') ||
    case when summary.count > 4 then ', and more' else '' end ||
    '. No worker action is required; this notice is for facilities monitoring only.',
  'work-list-missed-migration:' || u.id::text,
  now()
from users u join user_roles r on r.user_id=u.id cross join summary
where u.active and r.role='FACILITIES_MANAGER' and summary.count > 0
on conflict (idempotency_key) where idempotency_key is not null do nothing;

delete from notifications where type = 'WORK_LIST_OVERDUE';
