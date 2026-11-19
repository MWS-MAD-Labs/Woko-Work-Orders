// @vitest-environment jsdom
import React from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { api } from './api';
import { NotificationsView } from './NotificationsView';
vi.mock('./api', () => ({ api: vi.fn() }));
afterEach(() => { cleanup(); vi.clearAllMocks(); });
it('offers a facilities booking action for request and approval notifications', async () => {
  vi.mocked(api).mockResolvedValue(['REQUESTED', 'APPROVED'].map((event) => ({ id: event, type: `FACILITIES_BOOKING_${event}`, title: 'Booking update', message: 'Workshop · Hall', created_at: '2026-11-19T00:00:00Z', email_status: 'PENDING', read_status: false })));
  render(<NotificationsView locale="en" onClose={() => {}} onChanged={() => {}} canRetryEmail={false} />);
  const links = await screen.findAllByRole('link', { name: /Open facilities bookings/ });
  expect(links).toHaveLength(2);
  expect(links.every((link) => link.getAttribute('href') === '/?view=facilities')).toBe(true);
});
