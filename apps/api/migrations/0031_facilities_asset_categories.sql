alter table facilities_assets add column category text not null default 'Uncategorized'
  check (length(btrim(category)) between 1 and 80);
