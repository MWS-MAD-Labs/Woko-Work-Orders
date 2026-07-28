import { describe, expect, it } from 'vitest';
import { buildRawEmail, parseGmailServiceAccountCredentials } from './email.js';

describe('Gmail notification messages', () => {
  it('reads service-account JSON from an extensionless Docker secret', () => {
    expect(parseGmailServiceAccountCredentials(JSON.stringify({ client_email: 'woko-gmail@example.iam.gserviceaccount.com', private_key: '-----BEGIN PRIVATE KEY-----\\nkey\\n-----END PRIVATE KEY-----\\n' }))).toEqual({
      clientEmail: 'woko-gmail@example.iam.gserviceaccount.com',
      privateKey: '-----BEGIN PRIVATE KEY-----\\nkey\\n-----END PRIVATE KEY-----\\n',
    });
  });

  it('rejects invalid service-account credentials', () => {
    expect(() => parseGmailServiceAccountCredentials('not JSON')).toThrow('valid service-account JSON');
    expect(() => parseGmailServiceAccountCredentials('{}')).toThrow('client_email and private_key');
  });

  it('creates a Gmail-compatible base64url MIME message', () => {
    const raw = buildRawEmail({ toEmail: 'user@millennia21.id', toName: 'Test User', subject: 'Woko reminder', text: 'A work order is due today.' });
    const mime = Buffer.from(raw, 'base64url').toString('utf8');
    expect(mime).toContain('To: =?UTF-8?B?');
    expect(mime).toContain('<user@millennia21.id>');
    expect(mime).toContain('Content-Transfer-Encoding: base64');
    expect(mime).not.toContain('\nBcc:');
  });

  it('builds multipart alternative messages when HTML is provided', () => {
    const raw = buildRawEmail({ toEmail: 'user@millennia21.id', subject: 'Styled notification', text: 'Plain fallback', html: '<strong>Styled notification</strong>' });
    const mime = Buffer.from(raw, 'base64url').toString('utf8');
    expect(mime).toContain('Content-Type: multipart/alternative');
    expect(mime).toContain('Content-Type: text/plain; charset=UTF-8');
    expect(mime).toContain('Content-Type: text/html; charset=UTF-8');
  });

  it('removes newline characters from user-controlled headers', () => {
    const raw = buildRawEmail({ toEmail: 'user@millennia21.id', toName: 'Test\nBcc: attacker@example.com', subject: 'Subject\r\nBcc: attacker@example.com', text: 'Safe body' });
    const mime = Buffer.from(raw, 'base64url').toString('utf8');
    expect(mime).not.toContain('\nBcc: attacker@example.com');
  });
});
