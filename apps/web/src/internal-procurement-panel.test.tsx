// @vitest-environment jsdom
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { InternalProcurementPanel } from './WorkOrderForms';
import { api, uploadWithProgress } from './api';
import type { CurrentUser, WorkOrder } from './types';

vi.mock('./api', () => ({ api: vi.fn(), uploadWithProgress: vi.fn(), createIdempotencyKey: vi.fn() }));
const user: CurrentUser = { id: 'manager', email: 'manager@example.test', fullName: 'Manager', roles: ['ADMINISTRATOR'], preferredLocale: 'en', sessionExpiresAt: '2099-01-01' };
const order = {
  id: 'order-15', work_type: 'INTERNAL', version: 3, assignees: [], attachments: [],
  procurement: { status: 'SUBMITTED', version: 2, requirement_note: null, submitted_at: null, decision_note: null },
} as unknown as WorkOrder;

afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.clearAllMocks(); });

describe('internal procurement optimistic versions', () => {
  it('approves with the refreshed version after participants change without remounting', async () => {
    vi.mocked(api).mockResolvedValue({});
    vi.spyOn(window, 'prompt').mockReturnValue('Approved by Finance');
    const onChanged = vi.fn();
    const view = render(<InternalProcurementPanel order={order} currentUser={user} onChanged={onChanged} />);
    view.rerender(<InternalProcurementPanel order={{ ...order, version: 4 }} currentUser={user} onChanged={onChanged} />);
    fireEvent.click(screen.getByRole('button', { name: /^Approve$/ }));
    await waitFor(() => expect(api).toHaveBeenCalled());
    expect(JSON.parse(vi.mocked(api).mock.calls[0]![1]!.body as string)).toMatchObject({ expectedVersion: 4, expectedProcurementVersion: 2, decision: 'APPROVED' });
  });

  it('retains upload-returned versions across rerenders of the same snapshot', async () => {
    vi.mocked(uploadWithProgress).mockResolvedValue({ id: 'attachment-1', version: 7 });
    vi.mocked(api).mockResolvedValue({});
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const draft = { ...order, version: 6, procurement: { ...order.procurement!, status: 'PROPOSAL_REQUIRED' as const } };
    const onChanged = vi.fn();
    const view = render(<InternalProcurementPanel order={draft} currentUser={user} onChanged={onChanged} />);
    fireEvent.change(screen.getByLabelText('Choose a procurement proposal file to upload'), { target: { files: [new File(['proposal'], 'proposal.pdf', { type: 'application/pdf' })] } });
    fireEvent.click(screen.getByRole('button', { name: /^Upload$/ }));
    await screen.findByRole('button', { name: 'Record proposal submitted' });
    view.rerender(<InternalProcurementPanel order={{ ...draft }} currentUser={user} onChanged={onChanged} />);
    fireEvent.click(screen.getByRole('button', { name: 'Record proposal submitted' }));
    await waitFor(() => expect(api).toHaveBeenCalled());
    expect(JSON.parse(vi.mocked(api).mock.calls[0]![1]!.body as string)).toMatchObject({ expectedVersion: 7, attachmentIds: ['attachment-1'] });
  });

  it('uses the new order version when switching orders in the same panel', async () => {
    vi.mocked(api).mockResolvedValue({});
    vi.spyOn(window, 'prompt').mockReturnValue('Approved by Finance');
    const onChanged = vi.fn();
    const view = render(<InternalProcurementPanel order={order} currentUser={user} onChanged={onChanged} />);
    view.rerender(<InternalProcurementPanel order={{ ...order, id: 'order-16', version: 10 }} currentUser={user} onChanged={onChanged} />);
    fireEvent.click(screen.getByRole('button', { name: /^Approve$/ }));
    await waitFor(() => expect(api).toHaveBeenCalled());
    expect(JSON.parse(vi.mocked(api).mock.calls[0]![1]!.body as string).expectedVersion).toBe(10);
  });
});
