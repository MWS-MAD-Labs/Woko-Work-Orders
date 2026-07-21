import { describe, expect, it } from 'vitest';
import { localizeNotification } from './notification-localization.js';

describe('notification localization', () => {
  it('keeps English notifications unchanged', () => {
    const notification = { type: 'DUE_TODAY', title: 'FAC-2026-0001: due today', message: 'Repair door is due today.' };
    expect(localizeNotification(notification, 'en')).toEqual(notification);
  });

  it('localizes system copy while preserving the project title', () => {
    const notification = { type: 'DUE_TODAY', title: 'FAC-2026-0001: due today', message: 'Repair door is due today.' };
    expect(localizeNotification(notification, 'id')).toEqual({
      type: 'DUE_TODAY',
      title: 'FAC-2026-0001: jatuh tempo hari ini',
      message: 'Repair door jatuh tempo hari ini.',
    });
  });

  it('preserves user-authored progress comments', () => {
    const notification = { type: 'PROGRESS_COMMENT', title: 'FAC-2026-0001: new progress comment', message: 'Faisal: Apakah pekerjaan selesai?' };
    expect(localizeNotification(notification, 'id').message).toBe(notification.message);
  });
});
