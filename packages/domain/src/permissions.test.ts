import { describe, expect, it } from 'vitest';
import { can, permissions, permissionsForRoles, rolePermissions, rolesCan, rolesWithPermission } from './permissions.js';
import { roles } from './types.js';

describe('permissions', () => {
  it('gives every role the rights it had before, and nothing more', () => {
    expect(permissionsForRoles(['ADMINISTRATOR'])).toEqual(permissions.filter((p) => !['work-order:be-pic', 'work-order:be-worker', 'work-order:be-overseer', 'work-list:be-worker'].includes(p)));
    expect(permissionsForRoles(['FACILITIES_MANAGER'])).not.toContain('work-order:delete');
    expect(permissionsForRoles(['FACILITIES_MANAGER'])).not.toContain('users:manage');
    expect(permissionsForRoles(['FACILITIES_MANAGER'])).not.toContain('settings:manage');
    expect(permissionsForRoles(['PERSON_IN_CHARGE'])).toEqual(['work-order:create', 'work-order:be-pic']);
    expect(permissionsForRoles(['WORKER'])).toEqual(['work-order:be-worker', 'work-list:be-worker']);
    expect(permissionsForRoles(['OVERSEER'])).toEqual(['work-order:be-overseer']);
  });

  it('adds up the roles of one person without repeating a permission', () => {
    const both = permissionsForRoles(['PERSON_IN_CHARGE', 'WORKER', 'PERSON_IN_CHARGE']);
    expect(both).toEqual(['work-order:create', 'work-order:be-pic', 'work-order:be-worker', 'work-list:be-worker']);
    expect(permissionsForRoles([])).toEqual([]);
  });

  it('answers from permissions, roles, or the roles that hold it', () => {
    expect(can(['work-order:manage'], 'work-order:manage')).toBe(true);
    expect(can(undefined, 'work-order:manage')).toBe(false);
    expect(rolesCan(['WORKER'], 'work-order:manage')).toBe(false);
    expect(rolesWithPermission('work-order:manage')).toEqual(['ADMINISTRATOR', 'FACILITIES_MANAGER']);
    expect(rolesWithPermission('work-list:be-worker')).toEqual(['WORKER']);
  });

  it('knows every role, and uses only listed permissions', () => {
    expect(Object.keys(rolePermissions).sort()).toEqual([...roles].sort());
    for (const list of Object.values(rolePermissions)) for (const p of list) expect(permissions).toContain(p);
  });
});
