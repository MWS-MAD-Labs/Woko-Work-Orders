import { describe, expect, it } from 'vitest';
import { rolesHave, userCan } from './permissions';
import type { CurrentUser } from './types';

const base: CurrentUser = { id: 'u', email: 'u@example.test', fullName: 'U', roles: ['PERSON_IN_CHARGE'], preferredLocale: 'en', sessionExpiresAt: '2099-01-01' };

describe('userCan', () => {
  it('uses the permissions the server sent', () => {
    expect(userCan({ ...base, permissions: ['work-order:approve'] }, 'work-order:approve')).toBe(true);
    expect(userCan({ ...base, permissions: [] }, 'work-order:create')).toBe(false);
  });

  it('falls back to the roles when the answer has no permissions', () => {
    expect(userCan(base, 'work-order:create')).toBe(true);
    expect(userCan(base, 'work-order:approve')).toBe(false);
  });

  it('answers for the people in a pick list', () => {
    expect(rolesHave(['WORKER'], 'work-order:be-worker')).toBe(true);
    expect(rolesHave(['OVERSEER'], 'work-order:be-worker')).toBe(false);
  });
});
