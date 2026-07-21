alter table users
  add column if not exists preferred_locale text not null default 'id'
  check (preferred_locale in ('id', 'en'));
