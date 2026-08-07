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

  it('localizes the generated missed Work List digest format', () => {
    const notification = { type: 'WORK_LIST_MISSED_DIGEST', title: 'Missed Work Lists · 2026-08-06', message: '2 Work Lists due 2026-08-06 were missed: Daily checks · Library, Daily checks · Hall. No worker action is required; this digest is for facilities monitoring only.' };
    expect(localizeNotification(notification, 'id')).toEqual({
      type: 'WORK_LIST_MISSED_DIGEST',
      title: 'Ringkasan daftar kerja terlewat',
      message: '2 daftar kerja dengan tenggat 2026-08-06 terlewat: Daily checks · Library, Daily checks · Hall. Tidak diperlukan tindakan dari pekerja; ringkasan ini hanya untuk pemantauan tim fasilitas.',
    });
  });

  it('localizes historical migration missed Work List digests', () => {
    const notification = { type: 'WORK_LIST_MISSED_DIGEST', title: 'Historical missed Work Lists', message: '1 Work List was converted from overdue to missed during deployment: Daily checks · Library. No worker action is required; this notice is for facilities monitoring only.' };
    expect(localizeNotification(notification, 'id').message).toBe('1 daftar kerja diubah dari terlambat menjadi terlewat saat penerapan sistem: Daily checks · Library. Tidak diperlukan tindakan dari pekerja; ringkasan ini hanya untuk pemantauan tim fasilitas.');
  });
});
