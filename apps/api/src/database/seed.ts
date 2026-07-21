import { sql } from './client.js';

try {
  await sql.begin(async (transaction) => {
    await transaction`
      insert into campuses (id, code, name)
      values ('10000000-0000-4000-8000-000000000001', 'MWS', 'Millennia World School')
      on conflict (id) do nothing
    `;
    await transaction`
      insert into buildings (id, campus_id, code, name)
      values
        ('20000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', 'MAIN', 'Gedung Utama'),
        ('20000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000001', 'SPORT', 'Area Olahraga')
      on conflict (id) do nothing
    `;

    await transaction`
      insert into location_options (id, building_id, parent_id, type_label, code, name, sort_order)
      values
        ('50000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', null, 'AREA', 'ACADEMIC', 'Academic Area', 10),
        ('50000000-0000-4000-8000-000000000002', '20000000-0000-4000-8000-000000000001', '50000000-0000-4000-8000-000000000001', 'FLOOR', 'L1', 'Level 1', 10),
        ('50000000-0000-4000-8000-000000000003', '20000000-0000-4000-8000-000000000001', '50000000-0000-4000-8000-000000000002', 'ROOM', '101', 'Room 101', 10),
        ('50000000-0000-4000-8000-000000000004', '20000000-0000-4000-8000-000000000001', '50000000-0000-4000-8000-000000000002', 'ROOM', '102', 'Room 102', 20),
        ('50000000-0000-4000-8000-000000000005', '20000000-0000-4000-8000-000000000002', null, 'AREA', 'FIELD', 'Sports Field', 10),
        ('50000000-0000-4000-8000-000000000006', '20000000-0000-4000-8000-000000000002', '50000000-0000-4000-8000-000000000005', 'ZONE', 'NORTH', 'North Zone', 10),
        ('50000000-0000-4000-8000-000000000007', '20000000-0000-4000-8000-000000000002', '50000000-0000-4000-8000-000000000005', 'ZONE', 'SOUTH', 'South Zone', 20)
      on conflict (id) do nothing
    `;

    await transaction`
      insert into academic_periods (id, name, type, start_date, end_date, academic_year_label, active)
      values
        ('40000000-0000-4000-8000-000000000001', 'Semester 1', 'SEMESTER', '2026-07-01', '2026-12-18', '2026/2027', true),
        ('40000000-0000-4000-8000-000000000002', 'Academic Year 2026/2027', 'ACADEMIC_YEAR', '2026-07-01', '2027-06-30', '2026/2027', true)
      on conflict (id) do nothing
    `;
  });
  console.log('Development seed complete.');
} finally {
  await sql.end();
}
