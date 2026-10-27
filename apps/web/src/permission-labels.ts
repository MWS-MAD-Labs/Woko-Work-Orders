import type { Permission, PermissionBundle } from '@woko/domain';
import type { Locale } from './i18n';

type Label = { name: string; help: string };

export const permissionLabels: Record<Locale, Record<Permission, Label>> = {
  en: {
    'work-order:create': { name: 'Create work orders', help: 'Start a new work order.' },
    'work-order:read-all': { name: 'See all work orders and reports', help: 'Open every work order, the organization-wide view, and the reports.' },
    'work-order:operate-any': { name: 'Act on any work order', help: 'Post progress, change condition, add evidence and procurement on a work order without being assigned to it.' },
    'work-order:transition-any': { name: 'Move any stage', help: 'Skip or go back a stage with a reason, and reject from review.' },
    'work-order:approve': { name: 'Approve and complete', help: 'Complete work orders and decide vendor and procurement proposals.' },
    'work-order:reopen': { name: 'Reopen completed work', help: 'Reopen a completed work order.' },
    'work-order:cancel': { name: 'Cancel work orders', help: 'Cancel a work order.' },
    'work-order:set-schedule': { name: 'Change priority and due date', help: 'Change the priority and the due date of a work order.' },
    'work-order:manage-participants': { name: 'Change people on any work order', help: 'Change the people involved in any work order.' },
    'work-order:read-audit': { name: 'See technical audit history', help: 'Open the technical audit history of a work order.' },
    'work-order:delete': { name: 'Delete work orders', help: 'Delete a work order for good.' },
    'work-order:be-pic': { name: 'Can be assigned as PIC', help: 'Appears in the list of people in charge.' },
    'work-order:be-worker': { name: 'Can be assigned as worker', help: 'Appears in the list of workers and can post progress on assigned work.' },
    'work-order:be-reviewer': { name: 'Can be assigned as reviewer', help: 'Appears in the list of reviewers.' },
    'work-order:be-overseer': { name: 'Can be assigned as overseer', help: 'Appears in the list of overseers.' },
    'work-list:manage': { name: 'Manage Routine Work', help: 'Create and change templates and see all occurrences.' },
    'work-list:be-worker': { name: 'Can be assigned Routine Work', help: 'Appears in the list of workers for templates and gets the reminders.' },
    'work-list:receive-digest': { name: 'Receive Routine Work digests', help: 'Gets the daily missed-work digest and the weekly summary.' },
    'facilities:request': { name: 'Borrow equipment', help: 'See assets and make or cancel own bookings.' },
    'facilities:manage': { name: 'Manage facilities bookings', help: 'Manage assets, decide bookings, inspect returns.' },
    'facilities:default-approver': { name: 'First choice for booking approval', help: 'New bookings are routed to people with this first.' },
    'settings:manage': { name: 'Manage organization settings', help: 'Change locations and work settings, and retry failed emails.' },
    'users:manage': { name: 'Manage user access', help: 'Register people and change their permissions.' },
  },
  id: {
    'work-order:create': { name: 'Membuat work order', help: 'Memulai work order baru.' },
    'work-order:read-all': { name: 'Melihat semua work order dan laporan', help: 'Membuka semua work order, tampilan seluruh organisasi, dan laporan.' },
    'work-order:operate-any': { name: 'Bertindak di work order mana pun', help: 'Mencatat progres, mengubah kondisi, menambah bukti dan procurement tanpa ditugaskan.' },
    'work-order:transition-any': { name: 'Memindahkan tahap apa pun', help: 'Melompat atau mundur tahap dengan alasan, dan menolak dari review.' },
    'work-order:approve': { name: 'Menyetujui dan menyelesaikan', help: 'Menyelesaikan work order dan memutuskan proposal vendor dan procurement.' },
    'work-order:reopen': { name: 'Membuka kembali pekerjaan selesai', help: 'Membuka kembali work order yang sudah selesai.' },
    'work-order:cancel': { name: 'Membatalkan work order', help: 'Membatalkan work order.' },
    'work-order:set-schedule': { name: 'Mengubah prioritas dan tenggat', help: 'Mengubah prioritas dan tenggat work order.' },
    'work-order:manage-participants': { name: 'Mengubah orang di work order mana pun', help: 'Mengubah orang yang terlibat di work order mana pun.' },
    'work-order:read-audit': { name: 'Melihat riwayat audit teknis', help: 'Membuka riwayat audit teknis work order.' },
    'work-order:delete': { name: 'Menghapus work order', help: 'Menghapus work order secara permanen.' },
    'work-order:be-pic': { name: 'Dapat ditugaskan sebagai PIC', help: 'Muncul di daftar penanggung jawab.' },
    'work-order:be-worker': { name: 'Dapat ditugaskan sebagai pekerja', help: 'Muncul di daftar pekerja dan dapat mencatat progres pekerjaan yang ditugaskan.' },
    'work-order:be-reviewer': { name: 'Dapat ditugaskan sebagai reviewer', help: 'Muncul di daftar reviewer.' },
    'work-order:be-overseer': { name: 'Dapat ditugaskan sebagai pengawas', help: 'Muncul di daftar pengawas.' },
    'work-list:manage': { name: 'Mengelola Pekerjaan Rutin', help: 'Membuat dan mengubah templat serta melihat semua jadwal.' },
    'work-list:be-worker': { name: 'Dapat ditugaskan Pekerjaan Rutin', help: 'Muncul di daftar pekerja templat dan menerima pengingat.' },
    'work-list:receive-digest': { name: 'Menerima ringkasan Pekerjaan Rutin', help: 'Menerima ringkasan harian pekerjaan terlewat dan ringkasan mingguan.' },
    'facilities:request': { name: 'Meminjam peralatan', help: 'Melihat aset serta membuat dan membatalkan pemesanan sendiri.' },
    'facilities:manage': { name: 'Mengelola pemesanan fasilitas', help: 'Mengelola aset, memutuskan pemesanan, memeriksa pengembalian.' },
    'facilities:default-approver': { name: 'Pilihan pertama persetujuan pemesanan', help: 'Pemesanan baru diarahkan ke orang dengan izin ini lebih dulu.' },
    'settings:manage': { name: 'Mengelola pengaturan organisasi', help: 'Mengubah lokasi dan pengaturan kerja, serta mengulang email gagal.' },
    'users:manage': { name: 'Mengelola akses pengguna', help: 'Mendaftarkan orang dan mengubah izin mereka.' },
  },
};

export const groupLabels: Record<Locale, Record<string, string>> = {
  en: { workOrders: 'Work orders', participation: 'Can be assigned', routineWork: 'Routine Work', facilities: 'Facilities', administration: 'Administration' },
  id: { workOrders: 'Work order', participation: 'Dapat ditugaskan', routineWork: 'Pekerjaan Rutin', facilities: 'Fasilitas', administration: 'Administrasi' },
};

export const bundleLabels: Record<Locale, Record<PermissionBundle, string>> = {
  en: { administrator: 'Administrator', facilitiesManager: 'Facilities Manager', personInCharge: 'Person in Charge', worker: 'Worker', overseer: 'Overseer' },
  id: { administrator: 'Administrator', facilitiesManager: 'Manajer Fasilitas', personInCharge: 'Penanggung Jawab', worker: 'Pekerja', overseer: 'Pengawas' },
};
