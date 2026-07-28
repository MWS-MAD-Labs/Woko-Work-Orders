import { readFileSync } from 'node:fs';
import { google, type gmail_v1 } from 'googleapis';
import { config } from './config.js';

let gmailClient: gmail_v1.Gmail | undefined;

function encodedHeader(value: string): string {
  return `=?UTF-8?B?${Buffer.from(value).toString('base64')}?=`;
}

function normalizedHeader(value: string): string {
  return value.replace(/[\r\n]+/g, ' ').trim();
}

export function buildRawEmail(input: { toEmail: string; toName?: string; subject: string; text: string; html?: string }): string {
  const recipient = input.toName
    ? `${encodedHeader(normalizedHeader(input.toName))} <${input.toEmail}>`
    : input.toEmail;
  const headers = [
    `From: ${encodedHeader(config.GMAIL_SENDER_NAME)} <${config.GMAIL_SENDER_EMAIL}>`,
    `To: ${recipient}`,
    `Subject: ${encodedHeader(normalizedHeader(input.subject))}`,
    'MIME-Version: 1.0',
  ];
  const mime = input.html
    ? (() => {
        const boundary = `woko-${crypto.randomUUID()}`;
        return [
          ...headers,
          `Content-Type: multipart/alternative; boundary="${boundary}"`,
          '',
          `--${boundary}`,
          'Content-Type: text/plain; charset=UTF-8',
          'Content-Transfer-Encoding: base64',
          '',
          Buffer.from(input.text).toString('base64'),
          `--${boundary}`,
          'Content-Type: text/html; charset=UTF-8',
          'Content-Transfer-Encoding: base64',
          '',
          Buffer.from(input.html).toString('base64'),
          `--${boundary}--`,
          '',
        ].join('\r\n');
      })()
    : [
        ...headers,
        'Content-Type: text/plain; charset=UTF-8',
        'Content-Transfer-Encoding: base64',
        '',
        Buffer.from(input.text).toString('base64'),
      ].join('\r\n');
  return Buffer.from(mime).toString('base64url');
}

export function parseGmailServiceAccountCredentials(raw: string): { clientEmail: string; privateKey: string } {
  let credentials: unknown;
  try {
    credentials = JSON.parse(raw);
  } catch {
    throw new Error('GMAIL_APPLICATION_CREDENTIALS must contain valid service-account JSON.');
  }
  if (!credentials || typeof credentials !== 'object') {
    throw new Error('GMAIL_APPLICATION_CREDENTIALS must contain a service-account JSON object.');
  }
  const { client_email: clientEmail, private_key: privateKey } = credentials as Record<string, unknown>;
  if (typeof clientEmail !== 'string' || !clientEmail || typeof privateKey !== 'string' || !privateKey) {
    throw new Error('GMAIL_APPLICATION_CREDENTIALS must contain client_email and private_key.');
  }
  return { clientEmail, privateKey };
}

function getGmail(): gmail_v1.Gmail {
  if (!config.GMAIL_APPLICATION_CREDENTIALS) throw new Error('GMAIL_APPLICATION_CREDENTIALS is not configured.');
  if (!config.GMAIL_SENDER_EMAIL) throw new Error('GMAIL_SENDER_EMAIL is not configured.');
  const credentials = parseGmailServiceAccountCredentials(readFileSync(config.GMAIL_APPLICATION_CREDENTIALS, 'utf8'));
  gmailClient ??= google.gmail({
    version: 'v1',
    auth: new google.auth.JWT({
      email: credentials.clientEmail,
      key: credentials.privateKey,
      scopes: ['https://www.googleapis.com/auth/gmail.send'],
      subject: config.GMAIL_SENDER_EMAIL,
    }),
  });
  return gmailClient;
}

export async function sendNotificationEmail(input: { toEmail: string; toName?: string; subject: string; text: string; html?: string }) {
  if (config.EMAIL_PROVIDER === 'disabled') return { disabled: true } as const;
  const response = await getGmail().users.messages.send({
    userId: 'me',
    requestBody: { raw: buildRawEmail(input) },
  });
  if (!response.data.id) throw new Error('Gmail API did not return a message ID.');
  return { disabled: false, messageId: response.data.id } as const;
}
