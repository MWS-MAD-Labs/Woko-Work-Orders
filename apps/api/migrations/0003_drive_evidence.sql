alter table work_orders drop constraint if exists work_orders_drive_provisioning_status_check;

update work_orders
set drive_provisioning_status = 'FAILED'
where drive_provisioning_status = 'PENDING';

alter table work_orders
  alter column drive_provisioning_status set default 'PROVISIONING';

alter table work_orders
  add constraint work_orders_drive_provisioning_status_check
  check (drive_provisioning_status in ('PROVISIONING', 'COMPLETE', 'FAILED'));

alter table work_orders
  add column if not exists drive_subfolders jsonb not null default '{}'::jsonb,
  add column if not exists drive_provisioning_error text,
  add column if not exists drive_provisioning_attempted_at timestamptz;

alter table attachments
  add column if not exists evidence_type text,
  add column if not exists source_type text not null default 'UPLOAD',
  add column if not exists linked_drive_file_id text,
  add column if not exists original_file_name text;

update attachments
set evidence_type = case drive_subfolder_type
  when 'INITIAL' then 'INITIAL'
  when 'PROGRESS' then 'PROGRESS'
  when 'PROPOSAL' then 'PROPOSAL'
  when 'COMPLETION' then 'COMPLETION'
  else 'PROGRESS'
end
where evidence_type is null;

alter table attachments
  alter column evidence_type set not null;

alter table attachments
  add constraint attachments_evidence_type_check
  check (evidence_type in ('INITIAL', 'PROGRESS', 'PROPOSAL', 'COMPLETION')),
  add constraint attachments_source_type_check
  check (source_type in ('UPLOAD', 'DRIVE_LINK'));

create index if not exists attachments_evidence_count_idx
  on attachments (work_order_id, evidence_type)
  where removed_at is null;
