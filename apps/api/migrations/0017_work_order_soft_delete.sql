alter table work_orders
  add column if not exists removed_at timestamptz,
  add column if not exists removed_by uuid references users(id);

create index if not exists work_orders_visible_due_idx
  on work_orders (status, due_date, priority)
  where removed_at is null;
