export type Locale = 'id' | 'en';

const translations = {
  id: {
    productName: 'Woko', appSubtitle: 'Work Order', allWork: 'Semua Pekerjaan', myWork: 'Pekerjaan Saya', approvals: 'Persetujuan',
    notifications: 'Notifikasi', profile: 'Profil', overview: 'Ringkasan hari ini', sessionExpires: 'Sesi berakhir', active: 'Aktif', overdue: 'Terlambat',
    blocked: 'Terhambat', review: 'Menunggu ulasan', search: 'Cari nomor, judul, lokasi...', filter: 'Filter', create: 'Buat Pekerjaan',
    OVERDUE: 'Terlambat', THIS_WEEK: 'Jatuh Tempo Minggu Ini', THIS_MONTH: 'Jatuh Tempo Bulan Ini', NEXT_MONTH: 'Bulan Depan',
    THIS_SEMESTER: 'Semester Ini', THIS_ACADEMIC_YEAR: 'Tahun Akademik Ini', FUTURE: 'Mendatang', ARCHIVE: 'Selesai & Arsip',
    due: 'Tenggat', updated: 'Diperbarui', noWork: 'Tidak ada pekerjaan di bagian ini.', demo: 'Mode pratinjau',
    demoText: 'API belum tersedia. Menampilkan data contoh untuk tinjauan antarmuka.', details: 'Detail pekerjaan', timeline: 'Riwayat progres',
    location: 'Lokasi', assignee: 'Penanggung jawab', pic: 'PIC', reviewer: 'Peninjau', overseers: 'Pengawas', workType: 'Jenis pekerjaan', priority: 'Prioritas', close: 'Tutup',
    language: 'Bahasa', reports: 'Laporan', organizationSettings: 'Pengaturan Organisasi', signOut: 'Keluar', projectProgress: 'Progres proyek',
    reviewerPicConflict: 'Peninjau harus berbeda dari setiap PIC.', defaultManager: 'Manajer Fasilitas bawaan', restrictionNote: 'Catatan pembatasan',
    picRequired: 'Pilih setidaknya satu PIC.', participantsUpdateFailed: 'Orang yang terlibat tidak dapat diperbarui.', managerAction: 'Tindakan manajer',
    editParticipants: 'Ubah orang yang terlibat', peopleInvolved: 'Orang yang terlibat', managePeople: 'Kelola orang', participantManagerOnly: 'Hanya PIC saat ini, Peninjau, Administrator, atau Manajer Fasilitas yang dapat mengubah orang yang terlibat.', reasonForChange: 'Alasan perubahan', saving: 'Menyimpan...', saveParticipants: 'Simpan orang yang terlibat',
    edit: 'Ubah', discussion: 'Diskusi', comment: 'Komentar', addComment: 'Tambah komentar', writeComment: 'Tulis pertanyaan atau komentar...', send: 'Kirim', noComments: 'Belum ada komentar.',
    commentAccess: 'PIC, Peninjau, dan Pengawas dapat berdiskusi pada setiap riwayat progres.', noUpdates: 'Belum ada pembaruan tambahan.',
    blockedStatus: 'Terhambat', needsAttention: 'Perlu perhatian', onTrackStatus: 'Sesuai rencana', overdueStatus: 'Terlambat', approvalNeeded: 'Perlu persetujuan', finalCheck: 'Pemeriksaan akhir',
  },
  en: {
    productName: 'Woko', appSubtitle: 'Work Order', allWork: 'All Work Orders', myWork: 'My Work', approvals: 'Approvals', notifications: 'Notifications',
    profile: 'Profile', overview: 'Today at a glance', sessionExpires: 'Session expires', active: 'Active', overdue: 'Overdue', blocked: 'Blocked', review: 'Awaiting review',
    search: 'Search number, title, location...', filter: 'Filter', create: 'New Work', OVERDUE: 'Overdue', THIS_WEEK: 'Due This Week',
    THIS_MONTH: 'Due This Month', NEXT_MONTH: 'Due Next Month', THIS_SEMESTER: 'Due This Semester', THIS_ACADEMIC_YEAR: 'Due This Academic Year',
    FUTURE: 'Future', ARCHIVE: 'Completed & Archive', due: 'Due', updated: 'Updated', noWork: 'There is no work in this section.', demo: 'Preview mode',
    demoText: 'The API is unavailable. Showing sample data for interface review.', details: 'Work-order details', timeline: 'Progress history', location: 'Location',
    assignee: 'Person in charge', pic: 'PIC', reviewer: 'Reviewer', overseers: 'Overseers', workType: 'Work type', priority: 'Priority', close: 'Close',
    language: 'Language', reports: 'Reports', organizationSettings: 'Organization Settings', signOut: 'Sign out', projectProgress: 'Project progress',
    reviewerPicConflict: 'Reviewer must be different from every PIC.', defaultManager: 'Default Facilities Manager', restrictionNote: 'Restriction note',
    picRequired: 'Select at least one PIC.', participantsUpdateFailed: 'The people involved could not be updated.', managerAction: 'Manager action',
    editParticipants: 'Update people involved', peopleInvolved: 'People involved', managePeople: 'Manage people', participantManagerOnly: 'Only a current PIC, the Reviewer, an Administrator, or a Facilities Manager can change the people involved.', reasonForChange: 'Reason for change', saving: 'Saving...', saveParticipants: 'Save participants',
    edit: 'Edit', discussion: 'Discussion', comment: 'Comment', addComment: 'Add comment', writeComment: 'Write a question or comment...', send: 'Send', noComments: 'No comments yet.',
    commentAccess: 'PICs, the Reviewer, and Overseers can discuss each progress entry.', noUpdates: 'No additional updates yet.',
    blockedStatus: 'Blocked', needsAttention: 'Needs attention', onTrackStatus: 'On track', overdueStatus: 'Overdue', approvalNeeded: 'Approval needed', finalCheck: 'Final check',
  },
} as const;

export type TranslationKey = keyof typeof translations.id;

export function translator(locale: Locale) {
  return (key: TranslationKey) => translations[locale][key];
}
