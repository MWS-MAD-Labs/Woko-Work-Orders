update notifications
set title = 'Work Lists marked as missed',
    message = regexp_replace(message, '^([0-9]+) Work List(s?) were missed: ', E'\\1 Work List\\2 passed their deadline and were marked as missed: ') ||
      case when message like '%No worker action is required; this notice is for facilities monitoring only.' then ''
        else ' No worker action is required; this notice is for facilities monitoring only.' end,
    acknowledged_at = coalesce(acknowledged_at, now())
where type = 'WORK_LIST_MISSED';
