-- Identity from the Hub (Access Standard AS-10): a person is known by the Central person id the Hub session carries.
-- A Google subject is no longer required, since a person who signs in through the Hub never has one here.
alter table users add column if not exists central_person_id text;
alter table users alter column google_subject_id drop not null;
create unique index if not exists users_central_person_id_key on users (central_person_id) where central_person_id is not null;
