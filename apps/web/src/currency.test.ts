import { describe, expect, it } from 'vitest';
import { formatIdrCurrency, formatIdrInput, parseIdrInput } from './currency';

describe('IDR currency input', () => {
  it('formats digits while the user types', () => {
    expect(formatIdrInput('125000000')).toBe('125.000.000');
    expect(formatIdrInput('Rp 125.000.000')).toBe('125.000.000');
  });

  it('converts formatted input back to a numeric API value', () => {
    expect(parseIdrInput('125.000.000')).toBe(125000000);
  });

  it('shows a complete rupiah value as a hint', () => {
    expect(formatIdrCurrency(125000000)).toContain('125.000.000');
  });
});
