import { describe, expect, it } from 'vitest';
import { renderInvitationEmail } from './invitation-email.js';

describe('user invitation email', () => {
  it('includes first-sign-in instructions and the application login link', () => {
    const content = renderInvitationEmail({ recipientName: 'Test User' });
    expect(content.subject).toContain('invited');
    expect(content.text).toContain('Hello Test User');
    expect(content.text).toContain('/login');
    expect(content.html).toContain('Sign in to Woko');
  });

  it('escapes the recipient name in HTML', () => {
    const content = renderInvitationEmail({ recipientName: '<script>alert(1)</script>' });
    expect(content.html).not.toContain('<script>');
    expect(content.html).toContain('&lt;script&gt;');
  });
});
