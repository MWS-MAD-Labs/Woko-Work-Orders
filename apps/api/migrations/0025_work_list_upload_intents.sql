create table if not exists work_list_evidence_uploads (
  id uuid primary key default gen_random_uuid(),
  occurrence_id uuid not null references work_list_occurrences(id) on delete cascade,
  occurrence_item_id uuid not null references work_list_occurrence_items(id) on delete cascade,
  uploaded_by uuid not null references users(id),
  drive_file_id text,
  status text not null default 'PENDING' check (status in ('PENDING', 'COMPLETED', 'CANCELLED')),
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

create index if not exists work_list_evidence_uploads_cleanup_idx
  on work_list_evidence_uploads(status, created_at);
