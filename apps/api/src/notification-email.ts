import { config } from './config.js';
import { emailCopy, localizeNotification, localizedValue, type NotificationLocale } from './notification-localization.js';

export interface NotificationEmailData {
  type: string;
  title: string;
  message: string;
  recipientName: string;
  workOrderId: string | null;
  workOrderNumber: string | null;
  workOrderTitle: string | null;
  priority: string | null;
  condition: string | null;
  workflowStage: string | null;
  dueDate: string | null;
  locale?: NotificationLocale;
}

interface TemplateTheme {
  eyebrow: string;
  badge: string;
  accent: string;
  tint: string;
  badgeText: string;
  icon: string;
}

const palette = {
  sky: '#8dd7f7', skyStrong: '#176f95', skySoft: '#eaf8fe', golden: '#f5c84c', goldenStrong: '#80600b', goldenSoft: '#fff7dc',
  sage: '#5f7d6b', red: '#a52c30', ink: '#20313a', muted: '#64747c', line: '#dce7ec', canvas: '#f6fbfd', white: '#ffffff',
} as const;

const visualThemes: Record<string, Pick<TemplateTheme, 'accent' | 'tint' | 'badgeText' | 'icon'>> = {
  ASSIGNMENT: { accent: palette.sky, tint: palette.skySoft, badgeText: palette.skyStrong, icon: 'A' },
  REASSIGNMENT: { accent: palette.sky, tint: palette.skySoft, badgeText: palette.skyStrong, icon: 'R' },
  PROGRESS_COMMENT: { accent: palette.sky, tint: palette.skySoft, badgeText: palette.skyStrong, icon: 'C' },
  DUE_DATE_CHANGED: { accent: palette.golden, tint: palette.goldenSoft, badgeText: palette.goldenStrong, icon: 'D' },
  CRITICAL_PRIORITY_CHANGED: { accent: palette.red, tint: '#f9eaea', badgeText: '#8e2024', icon: '!' },
  DUE_IN_SEVEN_DAYS: { accent: palette.sky, tint: palette.skySoft, badgeText: palette.skyStrong, icon: '7' },
  DUE_IN_TWO_DAYS: { accent: palette.golden, tint: palette.goldenSoft, badgeText: palette.goldenStrong, icon: '2' },
  DUE_TODAY: { accent: palette.red, tint: '#f9eaea', badgeText: '#8e2024', icon: '!' },
  FIRST_DAY_OVERDUE: { accent: palette.red, tint: '#f9eaea', badgeText: '#8e2024', icon: '!' },
  CRITICAL_OVERDUE_REMINDER: { accent: palette.red, tint: '#f9eaea', badgeText: '#8e2024', icon: '!' },
  OVERDUE_REMINDER: { accent: palette.red, tint: '#f9eaea', badgeText: '#8e2024', icon: '!' },
  CONDITION_CHANGED: { accent: palette.golden, tint: palette.goldenSoft, badgeText: palette.goldenStrong, icon: '!' },
  PROPOSAL_SUBMITTED: { accent: palette.golden, tint: palette.goldenSoft, badgeText: palette.goldenStrong, icon: 'P' },
  PROPOSAL_APPROVED: { accent: palette.sage, tint: '#eaf1ec', badgeText: '#426451', icon: '✓' },
  PROPOSAL_REJECTED: { accent: palette.red, tint: '#f9eaea', badgeText: '#8e2024', icon: '×' },
  PROPOSAL_REVISION_REQUIRED: { accent: palette.golden, tint: palette.goldenSoft, badgeText: palette.goldenStrong, icon: '↻' },
  COMPLETION_REVIEW_SUBMITTED: { accent: palette.sky, tint: palette.skySoft, badgeText: palette.skyStrong, icon: 'C' },
  COMPLETION_APPROVED: { accent: palette.sage, tint: '#eaf1ec', badgeText: '#426451', icon: '✓' },
  COMPLETION_REJECTED: { accent: palette.red, tint: '#f9eaea', badgeText: '#8e2024', icon: '×' },
  WORK_ORDER_REOPENED: { accent: palette.golden, tint: palette.goldenSoft, badgeText: palette.goldenStrong, icon: '↻' },
  WORK_ORDER_CANCELLED: { accent: palette.muted, tint: '#eee9e6', badgeText: '#5b5051', icon: '×' },
};

function escapeHtml(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#039;');
}

function themeFor(data: NotificationEmailData, locale: NotificationLocale): TemplateTheme {
  const copy = emailCopy[locale];
  const labels: Record<string, [string, string]> = {
    ASSIGNMENT: [copy.responsibilityUpdate, copy.assigned], REASSIGNMENT: [copy.responsibilityUpdate, copy.reassigned],
    PROGRESS_COMMENT: [copy.progressDiscussion, copy.newComment], DUE_DATE_CHANGED: [copy.scheduleUpdate, copy.dueDateChanged],
    CRITICAL_PRIORITY_CHANGED: [copy.priorityUpdate, copy.criticalPriority], DUE_IN_SEVEN_DAYS: [copy.upcomingDeadline, copy.dueIn7Days],
    DUE_IN_TWO_DAYS: [copy.upcomingDeadline, copy.dueIn2Days], DUE_TODAY: [copy.deadlineReminder, copy.dueToday],
    FIRST_DAY_OVERDUE: [copy.overdueAlert, copy.firstDayOverdue], CRITICAL_OVERDUE_REMINDER: [copy.criticalOverdueAlert, copy.criticalOverdue],
    OVERDUE_REMINDER: [copy.overdueReminder, copy.overdue], CONDITION_CHANGED: [copy.conditionUpdate, copy.conditionChanged],
    PROPOSAL_SUBMITTED: [copy.vendorProposal, copy.awaitingApproval], PROPOSAL_APPROVED: [copy.proposalDecision, copy.approved],
    PROPOSAL_REJECTED: [copy.proposalDecision, copy.rejected], PROPOSAL_REVISION_REQUIRED: [copy.proposalDecision, copy.revisionRequired],
    COMPLETION_REVIEW_SUBMITTED: [copy.completionReview, copy.reviewSubmitted], COMPLETION_APPROVED: [copy.completionDecision, copy.approved],
    COMPLETION_REJECTED: [copy.completionDecision, copy.changesRequired], WORK_ORDER_REOPENED: [copy.workOrderStatus, copy.reopened],
    WORK_ORDER_CANCELLED: [copy.workOrderStatus, copy.cancelled],
  };
  const visual = visualThemes[data.type] ?? { accent: palette.sky, tint: palette.skySoft, badgeText: palette.skyStrong, icon: 'W' };
  const [eyebrow, defaultBadge] = labels[data.type] ?? [copy.workOrderUpdate, localizedValue(data.type, locale)];
  if (data.type === 'CONDITION_CHANGED') {
    if (data.condition === 'BLOCKED') return { eyebrow, badge: copy.blocked, ...visual, accent: palette.red, tint: '#f9eaea', badgeText: '#8e2024' };
    if (data.condition === 'ON_TRACK') return { eyebrow, badge: copy.onTrack, ...visual, accent: palette.sage, tint: '#eaf1ec', badgeText: '#426451', icon: '✓' };
    return { eyebrow, badge: copy.atRisk, ...visual };
  }
  return { eyebrow, badge: defaultBadge, ...visual };
}

function workOrderUrl(workOrderId: string | null): string {
  const base = config.APP_BASE_URL.replace(/\/$/, '');
  return workOrderId ? `${base}/?workOrder=${encodeURIComponent(workOrderId)}` : base;
}

export function renderNotificationEmail(data: NotificationEmailData): { html: string; text: string } {
  const locale = data.locale ?? 'en';
  const copy = emailCopy[locale];
  const localized = localizeNotification(data, locale);
  const theme = themeFor(data, locale);
  const url = workOrderUrl(data.workOrderId);
  const number = data.workOrderNumber ?? copy.notification;
  const workTitle = data.workOrderTitle ?? localized.title;
  const details = [
    [copy.priority, localizedValue(data.priority, locale)], [copy.condition, localizedValue(data.condition, locale)],
    [copy.stage, localizedValue(data.workflowStage, locale)], [copy.dueDate, data.dueDate ?? '—'],
  ];
  const text = [
    'Woko Work Orders · Millennia World School', theme.eyebrow, '', localized.title, localized.message, '', `${number} · ${workTitle}`,
    ...details.map(([key, value]) => `${key}: ${value}`), '', `${copy.openWorkOrder}: ${url}`, '', copy.automated,
  ].join('\n');
  const detailCells = details.map(([key, value]) => `<td width="50%" valign="top" style="padding:8px"><div style="background:#f5fafc;border:1px solid ${palette.line};border-radius:12px;padding:12px"><div style="color:${palette.muted};font-size:11px;text-transform:uppercase;font-weight:700">${escapeHtml(key!)}</div><div style="color:${palette.ink};font-size:14px;font-weight:700;margin-top:3px">${escapeHtml(value!)}</div></div></td>`);
  const html = `<!doctype html><html lang="${locale}"><head><meta name="viewport" content="width=device-width,initial-scale=1"><meta charset="UTF-8"><title>${escapeHtml(localized.title)}</title></head><body style="margin:0;background:${palette.canvas};font-family:Arial,sans-serif;color:${palette.ink}"><table role="presentation" width="100%" style="background:${palette.canvas}"><tr><td align="center" style="padding:28px 12px"><table role="presentation" width="100%" style="max-width:620px"><tr><td style="padding:0 6px 16px"><strong style="font-size:20px">Woko Work Orders</strong><div style="color:${palette.muted};font-size:12px">Millennia World School · ${escapeHtml(copy.facilitiesWork)}</div></td></tr><tr><td style="background:${palette.white};border:1px solid ${palette.line};border-radius:20px;overflow:hidden"><div style="height:6px;background:${theme.accent}"></div><div style="padding:26px"><div style="color:${palette.skyStrong};font-size:11px;text-transform:uppercase;font-weight:800">${escapeHtml(theme.eyebrow)}</div><h1 style="font-size:25px">${escapeHtml(localized.title)}</h1><span style="display:inline-block;padding:5px 10px;border-radius:999px;background:${theme.tint};color:${theme.badgeText};font-size:10px;font-weight:800">${escapeHtml(theme.badge)}</span><p>${escapeHtml(copy.hello)} ${escapeHtml(data.recipientName)},</p><p>${escapeHtml(localized.message)}</p><div style="border-left:5px solid ${theme.accent};padding:14px;background:#f5fafc"><small>${escapeHtml(number)}</small><strong style="display:block;margin-top:5px">${escapeHtml(workTitle)}</strong></div><table role="presentation" width="100%"><tr>${detailCells.slice(0, 2).join('')}</tr><tr>${detailCells.slice(2).join('')}</tr></table><div style="text-align:center;margin-top:20px"><a href="${escapeHtml(url)}" style="display:inline-block;background:${palette.skyStrong};color:${palette.white};text-decoration:none;padding:13px 22px;border-radius:12px;font-weight:700">${escapeHtml(copy.openWorkOrder)}</a><div style="margin-top:13px;color:${palette.muted};font-size:11px">${escapeHtml(copy.signIn)}</div></div></div></td></tr><tr><td align="center" style="padding:16px;color:${palette.muted};font-size:11px">${escapeHtml(copy.footer)}<br>${escapeHtml(copy.doNotReply)}</td></tr></table></td></tr></table></body></html>`;
  return { html, text };
}
