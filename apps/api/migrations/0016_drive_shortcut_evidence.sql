alter table attachments drop constraint if exists attachments_source_type_check;

alter table attachments
  add constraint attachments_source_type_check
  check (source_type in ('UPLOAD', 'DRIVE_LINK', 'DRIVE_COPY', 'DRIVE_MOVE', 'DRIVE_SHORTCUT'));
