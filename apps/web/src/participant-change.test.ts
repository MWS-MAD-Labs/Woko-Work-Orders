import { describe, expect, it } from 'vitest';
import { formatParticipantChanges } from './participant-change';

const users = [
  { id: 'a', full_name: 'Ayu' },
  { id: 'b', full_name: 'Budi' },
  { id: 'c', full_name: 'Citra' },
];

describe('participant change details', () => {
  it('formats explicit participant snapshots', () => {
    expect(formatParticipantChanges({
      changes: {
        pics: { added: [{ id: 'b', name: 'Budi' }], removed: [] },
        reviewer: { previous: null, next: null },
        overseers: { added: [], removed: [{ id: 'a', name: 'Ayu' }] },
      },
    }, users, 'en')).toEqual([
      'Added to PIC: Budi',
      'Removed from Overseers: Ayu',
    ]);
  });

  it('derives localized details from historical ID-only events', () => {
    expect(formatParticipantChanges({
      previous: { assigneeIds: ['a'], reviewerId: 'c', overseerIds: ['b'] },
      next: { assigneeIds: ['a', 'b'], reviewerId: null, overseerIds: [] },
    }, users, 'id')).toEqual([
      'Ditambahkan ke PIC: Budi',
      'Dihapus dari Pengawas: Budi',
      'Peninjau dihapus: Citra',
    ]);
  });
});
