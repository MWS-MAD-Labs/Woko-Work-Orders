alter type work_list_occurrence_status add value if not exists 'MISSED';

create index if not exists work_list_occurrences_period_status_idx
  on work_list_occurrences(period_date desc, status);
