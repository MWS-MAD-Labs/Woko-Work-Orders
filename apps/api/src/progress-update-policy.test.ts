import { describe, expect, it } from 'vitest';
import { canRecordMidProgress } from './work-orders';

describe('mid-progress update policy', () => {
  it('allows an update while active work is in progress', () => {
    expect(canRecordMidProgress('ACTIVE', 'IN_PROGRESS')).toBe(true);
  });

  it('does not treat completion or another stage as a mid-progress update', () => {
    expect(canRecordMidProgress('ACTIVE', 'REVIEW')).toBe(false);
    expect(canRecordMidProgress('COMPLETED', 'COMPLETED')).toBe(false);
  });
});
