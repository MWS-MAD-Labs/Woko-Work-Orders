import { describe, expect, it } from 'vitest';
import { claimHubRedirect } from './hub-redirect';

const memory = () => {
  const values = new Map<string, string>();
  return { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => void values.set(key, value) };
};

describe('claimHubRedirect', () => {
  it('lets the first redirect through and refuses another within ten seconds', () => {
    const storage = memory();
    expect(claimHubRedirect(storage, 1_000_000)).toBe(true);
    expect(claimHubRedirect(storage, 1_005_000)).toBe(false);
  });

  it('lets one through again after ten seconds', () => {
    const storage = memory();
    expect(claimHubRedirect(storage, 1_000_000)).toBe(true);
    expect(claimHubRedirect(storage, 1_010_001)).toBe(true);
  });

  it('refuses when the storage cannot be used, so it never loops', () => {
    const broken = { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); } };
    expect(claimHubRedirect(broken)).toBe(false);
  });
});
