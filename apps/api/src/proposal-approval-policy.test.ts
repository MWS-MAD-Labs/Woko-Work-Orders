import { describe, expect, it } from 'vitest';
import { canDecideProposal } from './work-orders';

describe('proposal approval policy', () => {
  it('allows a reviewer to decide a proposal they submitted when they are not a PIC', () => {
    const reviewerAndSubmitterId = 'reviewer-1';
    expect(canDecideProposal(reviewerAndSubmitterId, ['pic-1', 'pic-2'])).toBe(true);
  });

  it('prevents a reviewer from deciding when they are also a PIC', () => {
    const reviewerId = 'reviewer-1';
    expect(canDecideProposal(reviewerId, ['pic-1', reviewerId])).toBe(false);
  });
});
