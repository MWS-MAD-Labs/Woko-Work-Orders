import { describe, expect, it } from 'vitest';
import { diffDrivePermissionParticipants } from './work-orders';

describe('work-order Drive permission synchronization', () => {
  it('grants new and failed participants while revoking removed participants', () => {
    const result = diffDrivePermissionParticipants(
      [
        { id: 'creator', email: 'creator@example.com' },
        { id: 'worker', email: 'worker@example.com' },
      ],
      [
        { id: 'creator', email: 'creator@example.com', permission_id: 'permission-1', sync_status: 'COMPLETE' },
        { id: 'worker', email: 'worker@example.com', permission_id: null, sync_status: 'FAILED' },
        { id: 'removed', email: 'removed@example.com', permission_id: 'permission-2', sync_status: 'COMPLETE' },
      ],
    );

    expect(result.grant).toEqual([{ id: 'worker', email: 'worker@example.com' }]);
    expect(result.revoke.map((participant) => participant.id)).toEqual(['removed']);
  });

  it('replaces permission access when a participant email changes', () => {
    const result = diffDrivePermissionParticipants(
      [{ id: 'pic', email: 'new@example.com' }],
      [{ id: 'pic', email: 'old@example.com', permission_id: 'permission-1', sync_status: 'COMPLETE' }],
    );

    expect(result.grant).toEqual([{ id: 'pic', email: 'new@example.com' }]);
    expect(result.revoke.map((participant) => participant.email)).toEqual(['old@example.com']);
  });
});
