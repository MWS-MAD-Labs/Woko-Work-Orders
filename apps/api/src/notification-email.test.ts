import { describe, expect, it } from 'vitest';
import { renderNotificationEmail } from './notification-email.js';

const base = {
  type: 'ASSIGNMENT',
  title: 'Assigned: FAC-2026-0099',
  message: 'Repair classroom air-conditioning unit',
  recipientName: 'Faisal',
  workOrderId: '99999999-9999-4999-8999-999999999999',
  workOrderNumber: 'FAC-2026-0099',
  workOrderTitle: 'Repair classroom air-conditioning unit',
  priority: 'HIGH',
  condition: 'ON_TRACK',
  workflowStage: 'IN_PROGRESS',
  dueDate: '2026-07-25',
};

describe('notification email templates', () => {
  it('renders frontend-aligned MWS visual tokens and task-card details', () => {
    const content = renderNotificationEmail(base);
    expect(content.html).toContain('#176f95');
    expect(content.html).toContain('#f6fbfd');
    expect(content.html).toContain('FAC-2026-0099');
    expect(content.html).toContain('Open work order');
    expect(content.html).toContain('workOrder=99999999-9999-4999-8999-999999999999');
    expect(content.text).toContain('Priority: High');
  });

  it('uses condition-specific styling and escapes user content', () => {
    const content = renderNotificationEmail({ ...base, type: 'CONDITION_CHANGED', condition: 'BLOCKED', message: '<script>alert(1)</script>' });
    expect(content.html).toContain('Blocked');
    expect(content.html).toContain('#a52c30');
    expect(content.html).not.toContain('<script>');
    expect(content.html).toContain('&lt;script&gt;');
  });

  it('renders Routine Work reminders with a Routine Work action and no fake work-order details', () => {
    const content = renderNotificationEmail({ ...base, type: 'WORK_LIST_DAILY_REMINDER', title: 'Routine Work still to complete today', message: 'You have 2 Routine Work with unfinished required items today.', workOrderId: null, workOrderNumber: null, workOrderTitle: null, priority: null, condition: null, workflowStage: null, dueDate: null });
    expect(content.html).toContain('Open Routine Work');
    expect(content.html).toContain('view=work-lists');
    expect(content.html).not.toContain('FAC-2026-0099');
    expect(content.text).not.toContain('Priority:');
  });

  it('renders missed digests as informational messages without an action link', () => {
    const content = renderNotificationEmail({ ...base, type: 'WORK_LIST_MISSED_DIGEST', title: 'Yesterday’s missed Routine Work', message: '2 Routine Work were missed yesterday. No worker action is required; this digest is for facilities monitoring only.', workOrderId: null, workOrderNumber: null, workOrderTitle: null, priority: null, condition: null, workflowStage: null, dueDate: null });
    expect(content.html).toContain('Missed · no action required');
    expect(content.html).not.toContain('Open work order');
    expect(content.html).not.toContain('Open Routine Work');
    expect(content.text).toContain('No worker action is required');
  });

  it('renders system email copy in the recipient preferred language', () => {
    const content = renderNotificationEmail({ ...base, locale: 'id' });
    expect(content.html).toContain('Pembaruan tanggung jawab');
    expect(content.html).toContain('Buka pekerjaan');
    expect(content.text).toContain('Prioritas: Tinggi');
    expect(content.text).toContain('Pesan otomatis ini dikirim oleh Woko Work Orders.');
  });
});
