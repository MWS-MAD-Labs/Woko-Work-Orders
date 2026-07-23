import { describe, expect, it } from 'vitest';
import { resolveWorkOrderScope } from './work-orders.js';

describe('work-order visibility scope', () => {
  it('allows managers to choose organization-wide or personal scope', () => {
    expect(resolveWorkOrderScope(['ADMINISTRATOR'], 'all')).toBe('all');
    expect(resolveWorkOrderScope(['FACILITIES_MANAGER'], 'mine')).toBe('mine');
  });

  it('forces workers and other non-manager roles to personal scope', () => {
    expect(resolveWorkOrderScope(['WORKER'], 'all')).toBe('mine');
    expect(resolveWorkOrderScope(['PERSON_IN_CHARGE'], 'all')).toBe('mine');
    expect(resolveWorkOrderScope(['OVERSEER'], 'all')).toBe('mine');
  });

  it('uses the broadest role when a user has multiple roles', () => {
    expect(resolveWorkOrderScope(['WORKER', 'FACILITIES_MANAGER'], 'all')).toBe('all');
  });
});
