import { describe, expect, it } from 'vitest';
import { randomToken, safeHashEquals, sha256 } from './auth.js';

describe('authentication tokens', () => {
  it('creates high-entropy opaque values and stores only hashes', () => {
    const token = randomToken();
    expect(token.length).toBeGreaterThan(40);
    expect(sha256(token)).toMatch(/^[a-f0-9]{64}$/);
    expect(sha256(token)).not.toContain(token);
  });

  it('compares OAuth nonce values against their hashes', () => {
    const nonce = randomToken();
    expect(safeHashEquals(nonce, sha256(nonce))).toBe(true);
    expect(safeHashEquals(`${nonce}x`, sha256(nonce))).toBe(false);
  });
});
