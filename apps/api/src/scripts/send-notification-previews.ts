import { sendNotificationEmail } from '../email.js';
import { renderNotificationEmail } from '../notification-email.js';

const recipientEmail = process.argv[2];
if (!recipientEmail) throw new Error('Usage: tsx src/scripts/send-notification-previews.ts recipient@example.com');

const number = 'FAC-2026-0099';
const title = 'Repair classroom air-conditioning unit';
const dueDate = '2026-07-25';
const previews = [
  { type: 'ASSIGNMENT', subject: `Assigned: ${number}`, text: title },
  { type: 'REASSIGNMENT', subject: `Reassigned: ${number}`, text: `${title} was reassigned to Budi Santoso. Reason: Technician availability changed.` },
  { type: 'DUE_DATE_CHANGED', subject: `${number}: due date changed`, text: `${title} is now due ${dueDate}. Reason: Replacement parts will arrive later than planned.` },
  { type: 'CRITICAL_PRIORITY_CHANGED', subject: `${number}: critical priority changed`, text: `${title} changed from HIGH to CRITICAL. Reason: The room is required for examinations.` },
  { type: 'DUE_IN_SEVEN_DAYS', subject: `${number}: due in 7 days`, text: `${title} is due ${dueDate}.` },
  { type: 'DUE_IN_TWO_DAYS', subject: `${number}: due in 2 days`, text: `${title} is due ${dueDate}.` },
  { type: 'DUE_TODAY', subject: `${number}: due today`, text: `${title} is due today.` },
  { type: 'FIRST_DAY_OVERDUE', subject: `${number}: overdue`, text: `${title} became overdue today.` },
  { type: 'CRITICAL_OVERDUE_REMINDER', subject: `${number}: critical and overdue`, text: `${title} is critical and 2 days overdue.` },
  { type: 'OVERDUE_REMINDER', subject: `${number}: overdue reminder`, text: `${title} is 4 days overdue.` },
  { type: 'CONDITION_CHANGED_AT_RISK', subject: `${number}: AT RISK`, text: `${title} changed from ON TRACK to AT RISK. Vendor delivery may slip and could delay review by two days.` },
  { type: 'CONDITION_CHANGED_BLOCKED', subject: `${number}: BLOCKED`, text: `${title} changed from AT RISK to BLOCKED. Replacement compressor is unavailable until next week.` },
  { type: 'CONDITION_CHANGED_RESOLVED', subject: `${number}: ON TRACK`, text: `${title} changed from BLOCKED to ON TRACK. The replacement compressor has arrived.` },
  { type: 'PROPOSAL_SUBMITTED', subject: `${number}: proposal awaiting approval`, text: title },
  { type: 'PROPOSAL_APPROVED', subject: `${number}: APPROVED`, text: `${title}: Proposal approved. Work may begin on 2026-07-21.` },
  { type: 'PROPOSAL_REJECTED', subject: `${number}: REJECTED`, text: `${title}: Quoted price is above the approved budget.` },
  { type: 'PROPOSAL_REVISION_REQUIRED', subject: `${number}: REVISION REQUIRED`, text: `${title}: Please revise the warranty period and completion schedule.` },
  { type: 'COMPLETION_REVIEW_SUBMITTED', subject: `${number}: completion review submitted`, text: `${title}: Unit replaced, tested for two hours, and room temperature is stable.` },
  { type: 'COMPLETION_APPROVED', subject: `${number}: completion approved`, text: `${title}: Completion evidence reviewed and accepted.` },
  { type: 'COMPLETION_REJECTED', subject: `${number}: completion rejected`, text: `${title}: Add a clear photo of the installed unit and upload the test report.` },
  { type: 'WORK_ORDER_REOPENED', subject: `${number}: reopened`, text: `${title}. Reason: The unit stopped cooling again during the following school day.` },
  { type: 'WORK_ORDER_CANCELLED', subject: `${number}: cancelled`, text: `${title}. Reason: The room renovation project now includes replacement of this unit.` },
] as const;

const results: Array<{ type: string; messageId: string }> = [];
for (let index = 0; index < previews.length; index += 1) {
  const preview = previews[index]!;
  const subject = `[Woko preview ${index + 1}/${previews.length}] ${preview.subject}`;
  const condition = preview.type === 'CONDITION_CHANGED_BLOCKED' ? 'BLOCKED' : preview.type === 'CONDITION_CHANGED_AT_RISK' ? 'AT_RISK' : preview.type === 'CONDITION_CHANGED_RESOLVED' ? 'ON_TRACK' : 'ON_TRACK';
  const normalizedType = preview.type.startsWith('CONDITION_CHANGED_') ? 'CONDITION_CHANGED' : preview.type;
  const content = renderNotificationEmail({
    type: normalizedType,
    title: subject,
    message: preview.text,
    recipientName: 'Faisal',
    workOrderId: '99999999-9999-4999-8999-999999999999',
    workOrderNumber: number,
    workOrderTitle: title,
    priority: preview.type.includes('CRITICAL') ? 'CRITICAL' : 'HIGH',
    condition,
    workflowStage: preview.type.startsWith('PROPOSAL') ? 'APPROVAL' : preview.type.startsWith('COMPLETION') ? 'REVIEW' : 'IN_PROGRESS',
    dueDate,
  });
  const delivery = await sendNotificationEmail({
    toEmail: recipientEmail,
    toName: 'Faisal',
    subject,
    text: content.text,
    html: content.html,
  });
  if (delivery.disabled || !delivery.messageId) throw new Error(`Email delivery was disabled for ${preview.type}.`);
  results.push({ type: preview.type, messageId: delivery.messageId });
  console.log(`${index + 1}/${previews.length} ${preview.type}: ${delivery.messageId}`);
  await new Promise((resolve) => setTimeout(resolve, 150));
}

console.log(JSON.stringify({ recipientEmail, sent: results.length, results }, null, 2));
