// @vitest-environment jsdom
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { FacilitiesView } from './FacilitiesView';
import { api } from './api';
import type { CurrentUser } from './types';

vi.mock('./api', () => ({ api: vi.fn() }));

const borrower: CurrentUser = {
  id: 'user-1', email: 'borrower@example.test', fullName: 'Borrower', roles: ['WORKER'], preferredLocale: 'en', sessionExpiresAt: '2099-01-01',
};
const manager: CurrentUser = {
  id: 'manager-1', email: 'manager@example.test', fullName: 'Facilities Manager', roles: ['FACILITIES_MANAGER'], preferredLocale: 'en', sessionExpiresAt: '2099-01-01',
};
const otherManager: CurrentUser = {
  id: 'manager-2', email: 'other@example.test', fullName: 'Other Manager', roles: ['FACILITIES_MANAGER'], preferredLocale: 'en', sessionExpiresAt: '2099-01-01',
};
const administrator: CurrentUser = {
  id: 'admin-1', email: 'admin@example.test', fullName: 'Administrator', roles: ['ADMINISTRATOR'], preferredLocale: 'en', sessionExpiresAt: '2099-01-01',
};
const assets = [
  { id: 'asset-1', name: 'Projector', asset_code: 'AV-001', quantity: 3, active: true },
  { id: 'asset-2', name: 'Folding chair', asset_code: 'FUR-010', quantity: 12, active: true },
];
const request = (overrides: Record<string, unknown> = {}) => ({
  id: 'request-1', purpose: 'Workshop', location: 'Hall', starts_at: '2026-10-25T09:00:00.000Z', ends_at: '2026-10-25T12:00:00.000Z', status: 'PENDING', requester_id: 'user-1', requester_name: 'Borrower', approver_id: 'manager-1', approver_name: 'Facilities Manager', items: [{ asset_id: 'asset-1', asset_name: 'Projector', quantity: 1, returned_quantity: null, condition: null, issue_note: null }], ...overrides,
});

function mockFacilityApi(requests: unknown[] = []) {
  vi.mocked(api).mockImplementation((path: string) => {
    if (path === '/facilities/assets') return Promise.resolve(assets);
    if (path === '/facilities/requests') return Promise.resolve(requests);
    return Promise.resolve({});
  });
}
function postCall(path: string) {
  return vi.mocked(api).mock.calls.find(([calledPath, init]) => calledPath === path && init?.method === 'POST');
}

beforeEach(() => vi.useFakeTimers({ now: new Date('2026-10-24T03:00:00.000Z'), shouldAdvanceTime: true }));
afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); vi.clearAllMocks(); });

describe('FacilitiesView', () => {
  it('submits a multi-asset booking request using Jakarta ISO datetimes within the calendar-month horizon', async () => {
    mockFacilityApi();
    render(<FacilitiesView currentUser={borrower} locale="en" />);
    await screen.findByText('Projector');
    fireEvent.click(screen.getByRole('button', { name: 'New booking' }));
    fireEvent.change(screen.getByLabelText('Purpose'), { target: { value: 'Training session' } });
    fireEvent.change(screen.getByLabelText('Location'), { target: { value: 'Room 201' } });
    fireEvent.change(screen.getByLabelText('Starts at'), { target: { value: '2026-12-24T09:00' } });
    fireEvent.change(screen.getByLabelText('Ends at'), { target: { value: '2026-12-24T12:00' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add asset' }));
    fireEvent.change(screen.getByLabelText('Asset 2'), { target: { value: 'asset-2' } });
    fireEvent.click(screen.getByRole('button', { name: 'Request booking' }));

    await waitFor(() => expect(postCall('/facilities/requests')).toBeTruthy());
    expect(JSON.parse(postCall('/facilities/requests')![1]!.body as string)).toEqual({
      purpose: 'Training session', location: 'Room 201', startsAt: '2026-12-24T02:00:00.000Z', endsAt: '2026-12-24T05:00:00.000Z', items: [{ assetId: 'asset-1', quantity: 1 }, { assetId: 'asset-2', quantity: 1 }],
    });
  });

  it('rejects a date beyond the clamped two-calendar-month Jakarta horizon', async () => {
    mockFacilityApi();
    render(<FacilitiesView currentUser={borrower} locale="en" />);
    await screen.findByText('Projector');
    fireEvent.click(screen.getByRole('button', { name: 'New booking' }));
    fireEvent.change(screen.getByLabelText('Purpose'), { target: { value: 'Training session' } });
    fireEvent.change(screen.getByLabelText('Location'), { target: { value: 'Room 201' } });
    fireEvent.change(screen.getByLabelText('Starts at'), { target: { value: '2026-12-25T09:00' } });
    fireEvent.change(screen.getByLabelText('Ends at'), { target: { value: '2026-12-25T12:00' } });
    fireEvent.click(screen.getByRole('button', { name: 'Request booking' }));
    expect(await screen.findByText(/must end after it starts/i)).toBeTruthy();
    expect(postCall('/facilities/requests')).toBeUndefined();
  });

  it('creates inventory as active and refreshes the inventory drafts', async () => {
    mockFacilityApi();
    render(<FacilitiesView currentUser={manager} locale="en" />);
    await screen.findByText('Projector');
    fireEvent.click(screen.getByRole('button', { name: 'Manage inventory' }));
    fireEvent.change(screen.getByLabelText('Asset name'), { target: { value: 'Microphone' } });
    fireEvent.change(screen.getByLabelText('Asset code'), { target: { value: 'AV-002' } });
    fireEvent.change(screen.getByLabelText('Available quantity'), { target: { value: '4' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add asset' }));
    await waitFor(() => expect(postCall('/facilities/assets')).toBeTruthy());
    expect(JSON.parse(postCall('/facilities/assets')![1]!.body as string)).toEqual({ name: 'Microphone', assetCode: 'AV-002', quantity: 4, active: true });
    const assetCalls = vi.mocked(api).mock.calls.filter(([path]) => path === '/facilities/assets');
    expect(assetCalls).toHaveLength(3);
    expect(assetCalls.at(-1)).toEqual(['/facilities/assets']);
  });


  it('lets any global manager decide, inspect a return, and resolve return issues', async () => {
    let requests = [request()];
    vi.mocked(api).mockImplementation((path: string, init?: RequestInit) => {
      if (path === '/facilities/assets') return Promise.resolve(assets);
      if (path === '/facilities/requests') return Promise.resolve(requests);
      if (path.endsWith('/decision')) { requests = [request({ status: 'APPROVED', ends_at: '2026-10-23T12:00:00.000Z' })]; return Promise.resolve({}); }
      if (path.endsWith('/return')) { requests = [request({ status: 'RETURNED_WITH_ISSUES', ends_at: '2026-10-23T12:00:00.000Z', items: [{ asset_id: 'asset-1', asset_name: 'Projector', quantity: 1, returned_quantity: 0, condition: 'MISSING', issue_note: 'Not found' }] })]; return Promise.resolve({}); }
      if (path.endsWith('/resolve')) return Promise.resolve({ resolved: 1 });
      return Promise.resolve({});
    });
    render(<FacilitiesView currentUser={otherManager} locale="en" />);
    await screen.findByText('Workshop');
    fireEvent.click(screen.getByRole('button', { name: 'Decision' }));
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Approved for use' } });
    fireEvent.click(screen.getByRole('button', { name: 'Approve' }));
    await waitFor(() => expect(postCall('/facilities/requests/request-1/decision')).toBeTruthy());
    expect(JSON.parse(postCall('/facilities/requests/request-1/decision')![1]!.body as string)).toEqual({ decision: 'APPROVED', note: 'Approved for use' });
    await screen.findByRole('button', { name: 'Verify return' });
    fireEvent.click(screen.getByRole('button', { name: 'Verify return' }));
    fireEvent.change(screen.getByLabelText('Condition 1'), { target: { value: 'MISSING' } });
    fireEvent.change(screen.getByLabelText('Damage or missing-item note 1'), { target: { value: 'Not found' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(postCall('/facilities/requests/request-1/return')).toBeTruthy());
    await screen.findByRole('button', { name: 'Resolve issues' });
    fireEvent.click(screen.getByRole('button', { name: 'Resolve issues' }));
    fireEvent.change(screen.getByLabelText('Resolution note'), { target: { value: 'Replacement ordered' } });
    fireEvent.click(screen.getByRole('button', { name: 'Resolve' }));
    await waitFor(() => expect(postCall('/facilities/requests/request-1/resolve')).toBeTruthy());
    expect(JSON.parse(postCall('/facilities/requests/request-1/resolve')![1]!.body as string)).toEqual({ note: 'Replacement ordered' });
  });

  it('exposes review controls to an unassigned global manager', async () => {
    mockFacilityApi([request({ status: 'RETURNED_WITH_ISSUES', ends_at: '2026-10-23T12:00:00.000Z', items: [{ asset_id: 'asset-1', asset_name: 'Projector', quantity: 1, returned_quantity: 0, condition: 'MISSING', issue_note: 'Not found' }] })]);
    render(<FacilitiesView currentUser={otherManager} locale="en" />);
    await screen.findByText('Workshop');
    expect(screen.getByRole('button', { name: 'Resolve issues' })).toBeTruthy();
  });

  it('shows inspection state instead of closing an overdue approved booking', async () => {
    mockFacilityApi([request({ status: 'APPROVED', ends_at: '2020-01-01T12:00:00.000Z' })]);
    render(<FacilitiesView currentUser={borrower} locale="en" />);
    expect(await screen.findByText('Overdue — awaiting return inspection')).toBeTruthy();
    expect(screen.getByText('APPROVED')).toBeTruthy();
  });
});
