alter table approvals add column if not exists submitted_by uuid references users(id);
alter table approvals add column if not exists proposal_data jsonb not null default '{}'::jsonb;

create index if not exists approvals_pending_idx on approvals (approval_type, decision, decided_at desc);
