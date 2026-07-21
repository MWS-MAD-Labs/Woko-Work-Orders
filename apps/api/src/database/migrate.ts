import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { sql } from './client.js';

const migrationsPath = fileURLToPath(new URL('../../migrations/', import.meta.url));

try {
  await sql`
    create table if not exists schema_migrations (
      name text primary key,
      applied_at timestamptz not null default now()
    )
  `;
  const files = (await readdir(migrationsPath)).filter((file) => file.endsWith('.sql')).sort();
  for (const file of files) {
    const applied = await sql`select 1 from schema_migrations where name = ${file}`;
    if (applied.length) continue;
    const migration = await readFile(`${migrationsPath}/${file}`, 'utf8');
    await sql.begin(async (transaction) => {
      await transaction.unsafe(migration);
      await transaction`insert into schema_migrations (name) values (${file})`;
    });
    console.log(`Applied ${file}.`);
  }
  console.log('Database migration complete.');
} finally {
  await sql.end();
}
