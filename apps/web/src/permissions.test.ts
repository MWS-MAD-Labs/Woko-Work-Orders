import { describe, expect, it } from 'vitest';
import { permissionBundles } from '@woko/domain';
import { userCan } from './permissions';

describe('userCan', () => {
  it('answers from the permissions the person holds', () => {
    expect(userCan({ permissions: ['work-order.approve'] }, 'work-order.approve')).toBe(true);
    expect(userCan({ permissions: [] }, 'work-order.create')).toBe(false);
  });

  it('works for a person in a pick list the same way', () => {
    expect(userCan({ permissions: permissionBundles.worker }, 'work-order.be-worker')).toBe(true);
    expect(userCan({ permissions: permissionBundles.overseer }, 'work-order.be-worker')).toBe(false);
  });
});
