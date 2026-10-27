import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { rolePresetsFile } from '@woko/domain';

// `role-presets.json` is what Central's `seed:application-roles` reads (Access Standard AS-13). It is made from the
// permission bundles in the domain package, so the two cannot drift: `presets:write` makes it, `presets:check` fails
// when the file on disk is not what the code says.
export const rolePresetsPath = fileURLToPath(new URL('../../../../role-presets.json', import.meta.url));

export function renderRolePresets(): string {
  return `${JSON.stringify(rolePresetsFile(), null, 2)}\n`;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv[2] === 'check') {
    const onDisk = await readFile(rolePresetsPath, 'utf8').catch(() => '');
    if (onDisk !== renderRolePresets()) {
      console.error('role-presets.json is not what the code says. Run `npm run presets:write`.');
      process.exit(1);
    }
    console.log('role-presets.json is up to date.');
  } else {
    await writeFile(rolePresetsPath, renderRolePresets());
    console.log('Wrote role-presets.json');
  }
}
