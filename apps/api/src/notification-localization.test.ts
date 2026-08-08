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

  it('normalizes legacy English Routine Work notification terminology', () => {
    const legacy = { type: 'WORK_LIST_DAILY_REMINDER', title: 'Work Lists still to complete today', message: 'You have 2 Work Lists with unfinished items today: Daily checks · Library. Complete them before the deadline.' };
    expect(localizeNotification(legacy, 'en')).toEqual({
      ...legacy,
      title: 'Routine Work still to complete today',
      message: 'You have 2 Routine Work with unfinished items today: Daily checks · Library. Complete them before the deadline.',
    });
  });

  it('localizes current and legacy daily Routine Work reminder formats', () => {
    const current = { type: 'WORK_LIST_DAILY_REMINDER', title: 'Routine Work still to complete today', message: 'You have 2 Routine Work with unfinished items today: Daily checks · Library. Complete them before the deadline.' };
    const legacy = { ...current, title: 'Work Lists still to complete today', message: 'You have 2 Work Lists with unfinished items today: Daily checks · Library. Complete them before the deadline.' };
    const expected = 'Anda memiliki 2 pekerjaan rutin dengan item yang belum selesai hari ini: Daily checks · Library. Selesaikan sebelum tenggat.';
    expect(localizeNotification(current, 'id').message).toBe(expected);
    expect(localizeNotification(legacy, 'id').message).toBe(expected);
  });

  it('localizes the generated missed Routine Work digest format', () => {
    const notification = { type: 'WORK_LIST_MISSED_DIGEST', title: 'Missed Routine Work · 2026-08-06', message: '2 Routine Work due 2026-08-06 were missed: Daily checks · Library, Daily checks · Hall. No worker action is required; this digest is for facilities monitoring only.' };
    expect(localizeNotification(notification, 'id')).toEqual({
      type: 'WORK_LIST_MISSED_DIGEST',
      title: 'Ringkasan pekerjaan rutin terlewat',
      message: '2 pekerjaan rutin dengan tenggat 2026-08-06 terlewat: Daily checks · Library, Daily checks · Hall. Tidak diperlukan tindakan dari pekerja; ringkasan ini hanya untuk pemantauan tim fasilitas.',
    });
  });

  it('localizes historical migration missed Routine Work digests', () => {
    const notification = { type: 'WORK_LIST_MISSED_DIGEST', title: 'Historical missed Work Lists', message: '1 Work List was converted from overdue to missed during deployment: Daily checks · Library. No worker action is required; this notice is for facilities monitoring only.' };
    expect(localizeNotification(notification, 'id').message).toBe('1 pekerjaan rutin diubah dari terlambat menjadi terlewat saat penerapan sistem: Daily checks · Library. Tidak diperlukan tindakan dari pekerja; ringkasan ini hanya untuk pemantauan tim fasilitas.');
  });
});
