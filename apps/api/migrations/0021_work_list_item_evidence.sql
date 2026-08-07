alter table work_list_evidence
  add column if not exists occurrence_item_id uuid references work_list_occurrence_items(id) on delete cascade;

create index if not exists work_list_evidence_item_idx
  on work_list_evidence(occurrence_item_id, created_at);
