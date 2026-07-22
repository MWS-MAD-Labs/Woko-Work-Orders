import { config } from './config.js';

export interface InvitationEmailData {
  recipientName: string;
}

const palette = {
  skyStrong: '#176f95',
  skySoft: '#eaf8fe',
  ink: '#20313a',
  muted: '#64747c',
  line: '#dce7ec',
  canvas: '#f6fbfd',
  white: '#ffffff',
} as const;

function escapeHtml(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#039;');
}

export function renderInvitationEmail(data: InvitationEmailData): { subject: string; html: string; text: string } {
  const signInUrl = `${config.APP_BASE_URL.replace(/\/$/, '')}/login`;
  const subject = 'You have been invited to Woko Work Orders';
  const text = [
    'Woko Work Orders · Millennia World School',
    '',
    `Hello ${data.recipientName},`,
    '',
    'You have been given access to Woko Work Orders.',
    'Sign in for the first time with your registered Millennia World School Google Workspace account.',
    '',
    `Sign in to Woko: ${signInUrl}`,
    '',
    'This invitation is intended for your registered school email address. Please do not reply to this email.',
  ].join('\n');
  const html = `<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width,initial-scale=1"><meta charset="UTF-8"><title>${subject}</title></head><body style="margin:0;background:${palette.canvas};font-family:Arial,sans-serif;color:${palette.ink}"><table role="presentation" width="100%" style="background:${palette.canvas}"><tr><td align="center" style="padding:28px 12px"><table role="presentation" width="100%" style="max-width:620px"><tr><td style="padding:0 6px 16px"><strong style="font-size:20px">Woko Work Orders</strong><div style="color:${palette.muted};font-size:12px">Millennia World School</div></td></tr><tr><td style="background:${palette.white};border:1px solid ${palette.line};border-radius:20px;overflow:hidden"><div style="height:6px;background:${palette.skyStrong}"></div><div style="padding:30px"><div style="color:${palette.skyStrong};font-size:11px;text-transform:uppercase;font-weight:800">User invitation</div><h1 style="font-size:25px;line-height:1.3;margin:12px 0 18px">Welcome to Woko Work Orders</h1><p>Hello ${escapeHtml(data.recipientName)},</p><p style="line-height:1.6">You have been given access to Woko Work Orders. Sign in for the first time with your registered Millennia World School Google Workspace account.</p><div style="margin:22px 0;padding:14px;border-radius:12px;background:${palette.skySoft};color:${palette.skyStrong};font-size:13px">Use the same school email address where you received this invitation.</div><div style="text-align:center;margin-top:24px"><a href="${escapeHtml(signInUrl)}" style="display:inline-block;background:${palette.skyStrong};color:${palette.white};text-decoration:none;padding:13px 22px;border-radius:12px;font-weight:700">Sign in to Woko</a></div></div></td></tr><tr><td align="center" style="padding:16px;color:${palette.muted};font-size:11px">Automated invitation from Woko Work Orders · MAD Labs · Millennia World School<br>Please do not reply to this email.</td></tr></table></td></tr></table></body></html>`;
  return { subject, html, text };
}
