import { describe, expect, it } from 'vitest';
import { can, canAny, missingRequirements, withRequirements, withoutDependents, isPermission, permissionBundles, permissionGroups, permissionManifest, permissions, rolePresetsFile } from './permissions.js';

const managerOnly = ['work-order.operate-any', 'work-order.transition-any', 'work-order.approve', 'work-order.reopen', 'work-order.cancel', 'work-order.set-schedule', 'work-order.manage-participants', 'work-order.read-audit', 'work-order.read-all'] as const;

describe('permissions', () => {
  it('lists every permission once, in a group, and every group member exists', () => {
    expect(new Set(permissions).size).toBe(permissions.length);
    const grouped = permissionGroups.flatMap((group) => group.permissions);
    expect([...grouped].sort()).toEqual([...permissions].sort());
  });

  it('keeps the rights each bundle had before they became plain lists', () => {
    expect([...permissionBundles.administrator].sort()).toEqual(
      permissions.filter((p) => !['work-order.be-pic', 'work-order.be-worker', 'work-order.be-overseer', 'work-list.be-worker', 'work-list.receive-digest', 'facilities.default-approver'].includes(p)).sort(),
    );
    expect(permissionBundles.facilitiesManager).not.toContain('work-order.delete');
    expect(permissionBundles.facilitiesManager).not.toContain('users.manage');
    expect(permissionBundles.facilitiesManager).not.toContain('settings.manage');
    expect(permissionBundles.facilitiesManager).toContain('work-list.receive-digest');
    expect(permissionBundles.personInCharge).toEqual(['woko.use', 'work-order.create', 'work-order.be-pic', 'facilities.request']);
    expect(permissionBundles.worker).toEqual(['woko.use', 'work-order.be-worker', 'work-list.be-worker', 'facilities.request']);
    expect(permissionBundles.overseer).toEqual(['woko.use', 'work-order.be-overseer', 'facilities.request']);
  });

  it('keeps every manager action out of the PIC, worker and overseer bundles', () => {
    for (const bundle of ['administrator', 'facilitiesManager'] as const) for (const p of managerOnly) expect(permissionBundles[bundle]).toContain(p);
    for (const bundle of ['personInCharge', 'worker', 'overseer'] as const) for (const p of managerOnly) expect(permissionBundles[bundle]).not.toContain(p);
  });

  it('answers for one permission, any of several, and unknown values', () => {
    expect(can(['work-order.approve'], 'work-order.approve')).toBe(true);
    expect(can(undefined, 'work-order.approve')).toBe(false);
    expect(canAny(['work-order.be-pic'], ['work-order.be-worker', 'work-order.be-pic'])).toBe(true);
    expect(canAny([], ['work-order.be-pic'])).toBe(false);
    expect(isPermission('users.manage')).toBe(true);
    expect(isPermission('ADMINISTRATOR')).toBe(false);
    expect(isPermission(5)).toBe(false);
  });

  it('describes every permission once, and everything needs woko.use', () => {
    expect(permissionManifest.map((entry) => entry.key)).toEqual([...permissions]);
    for (const entry of permissionManifest) {
      expect((entry.description ?? '').length).toBeGreaterThan(5);
      if (entry.key !== 'woko.use') expect(entry.requires).toContain('woko.use');
    }
  });

  it('makes a manage permission need its read permission, and keeps requires inside the manifest', () => {
    const requires = new Map(permissionManifest.map((entry) => [entry.key as string, entry.requires ?? []] as const));
    for (const key of permissions.filter((candidate) => candidate.endsWith('.manage'))) {
      expect(requires.get(key)).toContain(key.replace('.manage', '.read'));
    }
    for (const needed of [...requires.values()].flat()) expect(requires.has(needed)).toBe(true);
  });

  it('gives every bundle what its permissions need, so a role never misses a requirement', () => {
    const requires = new Map(permissionManifest.map((entry) => [entry.key as string, entry.requires ?? []] as const));
    for (const [name, bundle] of Object.entries(permissionBundles)) {
      for (const key of bundle) for (const needed of requires.get(key) ?? []) expect([name, key, bundle.includes(needed as never)]).toEqual([name, key, true]);
    }
  });

  it('makes the starting roles from the bundles, none alike, all using manifest keys', () => {
    const file = rolePresetsFile();
    expect(file.application_id).toBe('woko');
    expect(file.roles.map((role) => role.key)).toEqual(['ADMINISTRATOR', 'FACILITIES_MANAGER', 'PERSON_IN_CHARGE', 'WORKER', 'OVERSEER']);
    expect(new Set(file.roles.map((role) => [...role.permissions].sort().join('|'))).size).toBe(file.roles.length);
    for (const role of file.roles) for (const key of role.permissions) expect(isPermission(key)).toBe(true);
  });

  it('finds what a list leaves out, and ticks and unticks together', () => {
    expect(missingRequirements(['users.manage'])).toEqual([['users.manage', 'woko.use'], ['users.manage', 'users.read']]);
    expect(missingRequirements([...permissionBundles.administrator])).toEqual([]);
    expect(withRequirements([], 'users.manage')).toEqual(['woko.use', 'users.read', 'users.manage']);
    expect(withoutDependents(['woko.use', 'users.read', 'users.manage', 'work-order.create'], 'users.read')).toEqual(['woko.use', 'work-order.create']);
    expect(withoutDependents(['woko.use', 'work-order.create'], 'woko.use')).toEqual([]);
  });
});
