import { describe, expect, it } from 'vitest';
import { permissionBundles } from '@woko/domain';
import { resolveWorkOrderScope } from './work-orders.js';

describe('work-order visibility scope', () => {
  it('allows people who can read everything to choose organization-wide or personal scope', () => {
    expect(resolveWorkOrderScope(permissionBundles.administrator, 'all')).toBe('all');
    expect(resolveWorkOrderScope(permissionBundles.facilitiesManager, 'mine')).toBe('mine');
  });

  it('forces everyone else to personal scope', () => {
    expect(resolveWorkOrderScope(permissionBundles.worker, 'all')).toBe('mine');
    expect(resolveWorkOrderScope(permissionBundles.personInCharge, 'all')).toBe('mine');
    expect(resolveWorkOrderScope(permissionBundles.overseer, 'all')).toBe('mine');
  });

  it('adds up when a person holds permissions of several kinds', () => {
    expect(resolveWorkOrderScope([...permissionBundles.worker, 'work-order.read-all'], 'all')).toBe('all');
  });
});
