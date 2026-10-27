import { describe, expect, it } from 'vitest';
import { can, canAny, isPermission, permissionBundles, permissionGroups, permissions } from './permissions.js';

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
    expect(permissionBundles.personInCharge).toEqual(['work-order.create', 'work-order.be-pic', 'facilities.request']);
    expect(permissionBundles.worker).toEqual(['work-order.be-worker', 'work-list.be-worker', 'facilities.request']);
    expect(permissionBundles.overseer).toEqual(['work-order.be-overseer', 'facilities.request']);
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
});
