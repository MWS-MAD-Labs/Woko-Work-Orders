// @vitest-environment jsdom
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { EnvironmentBanner } from './EnvironmentBanner';
import { api } from './api';

vi.mock('./api', () => ({ api: vi.fn() }));

beforeEach(() => localStorage.clear());
afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe('EnvironmentBanner', () => {
  it('points to the real Woko on a test stack, in Indonesian by default', async () => {
    vi.mocked(api).mockResolvedValue({ production_url: 'https://woko.example.org' });
    render(<EnvironmentBanner />);
    const link = await screen.findByRole('link', { name: 'woko.example.org' });
    expect(link.getAttribute('href')).toBe('https://woko.example.org');
    expect(screen.getByRole('note').textContent).toContain('Ini versi uji coba Woko');
    expect(document.body.classList.contains('has-env-banner')).toBe(true);
  });

  it('speaks English when the saved language is English', async () => {
    localStorage.setItem('woko-locale', 'en');
    vi.mocked(api).mockResolvedValue({ production_url: 'https://woko.example.org' });
    render(<EnvironmentBanner />);
    expect((await screen.findByRole('note')).textContent).toContain('This is a test version of Woko');
  });

  it('shows nothing on the real stack or when the config cannot be read', async () => {
    vi.mocked(api).mockResolvedValueOnce({ production_url: null });
    const first = render(<EnvironmentBanner />);
    await waitFor(() => expect(api).toHaveBeenCalled());
    expect(screen.queryByRole('note')).toBeNull();
    first.unmount();
    vi.mocked(api).mockRejectedValueOnce(new Error('down'));
    render(<EnvironmentBanner />);
    await waitFor(() => expect(api).toHaveBeenCalledTimes(2));
    expect(screen.queryByRole('note')).toBeNull();
    expect(document.body.classList.contains('has-env-banner')).toBe(false);
  });
});
