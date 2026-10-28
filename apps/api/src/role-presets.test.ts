import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { renderRolePresets, rolePresetsPath } from './scripts/role-presets-cli.js';

describe('role-presets.json', () => {
  it('is what the permission bundles say, so Central creates the roles the code expects', () => {
    expect(readFileSync(rolePresetsPath, 'utf8')).toBe(renderRolePresets());
  });
});
