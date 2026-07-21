export const demoOrders = [
  {
    id: '1', work_order_number: 'FAC-2026-0048', title: 'Perbaikan pintu kelas lantai 2', description: 'Memperbaiki engsel dan kusen pintu yang tidak menutup dengan aman.',
    category: 'DOORS_AND_WINDOWS', work_type: 'INTERNAL', priority: 'CRITICAL', condition: 'BLOCKED', workflow_stage: 'IN_PROGRESS', status: 'ACTIVE',
    due_date: '2026-07-15', planned_start_date: '2026-07-13', room_or_area: 'Kelas 2A-2D', floor: '2', building: 'Gedung Utama', campus: 'Millennia World School',
    assignee_id: 'u1', assignee_name: 'Budi Santoso', assignee_email: 'budi@millennia21.id', reviewer_name: 'Ayu Pratama', drive_folder_url: null,
    drive_provisioning_status: 'PROVISIONING', version: 3, created_at: '2026-07-08T02:00:00Z', updated_at: '2026-07-17T02:15:00Z', deadlineGroup: 'OVERDUE',
    updates: [{ id: 'p1', update_type: 'BLOCKER_UPDATE', previous_stage: 'IN_PROGRESS', new_stage: 'IN_PROGRESS', note: 'Menunggu engsel pengganti tiba dari pemasok.', author: 'Budi Santoso', created_at: '2026-07-17T02:15:00Z' }],
  },
  {
    id: '2', work_order_number: 'FAC-2026-0051', title: 'Pengecatan ulang koridor utama', description: 'Pengecatan ulang dinding koridor setelah jam sekolah.',
    category: 'PAINTING', work_type: 'VENDOR', priority: 'HIGH', condition: 'ON_TRACK', workflow_stage: 'APPROVAL', status: 'ACTIVE',
    due_date: '2026-07-19', planned_start_date: null, room_or_area: 'Koridor Utama', floor: '1', building: 'Gedung Utama', campus: 'Millennia World School',
    assignee_id: 'u2', assignee_name: 'Sari Lestari', assignee_email: 'sari@millennia21.id', reviewer_name: 'Ayu Pratama', drive_folder_url: '#',
    drive_provisioning_status: 'COMPLETE', version: 4, created_at: '2026-07-10T02:00:00Z', updated_at: '2026-07-16T06:20:00Z', deadlineGroup: 'THIS_WEEK', updates: [],
  },
  {
    id: '3', work_order_number: 'FAC-2026-0053', title: 'Penggantian unit AC ruang musik', description: 'Mengganti unit AC yang tidak lagi dapat diperbaiki.',
    category: 'AIR_CONDITIONING', work_type: 'VENDOR', priority: 'NORMAL', condition: 'AT_RISK', workflow_stage: 'FINDING_VENDOR', status: 'ACTIVE',
    due_date: '2026-07-29', planned_start_date: null, room_or_area: 'Ruang Musik', floor: '3', building: 'Gedung Utama', campus: 'Millennia World School',
    assignee_id: 'u1', assignee_name: 'Budi Santoso', assignee_email: 'budi@millennia21.id', reviewer_name: 'Ayu Pratama', drive_folder_url: null,
    drive_provisioning_status: 'PENDING', version: 2, created_at: '2026-07-12T03:00:00Z', updated_at: '2026-07-15T08:00:00Z', deadlineGroup: 'THIS_MONTH', updates: [],
  },
  {
    id: '4', work_order_number: 'FAC-2026-0054', title: 'Perbaikan pagar area olahraga', description: 'Perbaikan sambungan pagar yang rusak di sisi timur.',
    category: 'SAFETY_AND_SECURITY', work_type: 'INTERNAL', priority: 'HIGH', condition: 'ON_TRACK', workflow_stage: 'SCHEDULED', status: 'ACTIVE',
    due_date: '2026-08-14', planned_start_date: '2026-08-08', room_or_area: 'Pagar Timur', floor: null, building: 'Area Olahraga', campus: 'Millennia World School',
    assignee_id: 'u1', assignee_name: 'Budi Santoso', assignee_email: 'budi@millennia21.id', reviewer_name: 'Ayu Pratama', drive_folder_url: null,
    drive_provisioning_status: 'PENDING', version: 1, created_at: '2026-07-16T02:00:00Z', updated_at: '2026-07-16T02:00:00Z', deadlineGroup: 'NEXT_MONTH', updates: [],
  },
] as const;
