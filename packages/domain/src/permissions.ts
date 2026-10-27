// What a person may do. Access is a list of these kept per user; the code asks for a permission and nothing else.
export const permissions = [
  'work-order:create',
  'work-order:read-all',
  'work-order:operate-any',
  'work-order:transition-any',
  'work-order:approve',
  'work-order:reopen',
  'work-order:cancel',
  'work-order:set-schedule',
  'work-order:manage-participants',
  'work-order:read-audit',
  'work-order:delete',
  'work-order:be-pic',
  'work-order:be-worker',
  'work-order:be-reviewer',
  'work-order:be-overseer',
  'work-list:manage',
  'work-list:be-worker',
  'work-list:receive-digest',
  'facilities:request',
  'facilities:manage',
  'facilities:default-approver',
  'settings:manage',
  'users:manage',
] as const;
export type Permission = (typeof permissions)[number];

// The screen groups them for the person who grants access.
export const permissionGroups: ReadonlyArray<{ key: string; permissions: readonly Permission[] }> = [
  { key: 'workOrders', permissions: ['work-order:create', 'work-order:read-all', 'work-order:operate-any', 'work-order:transition-any', 'work-order:approve', 'work-order:reopen', 'work-order:cancel', 'work-order:set-schedule', 'work-order:manage-participants', 'work-order:read-audit', 'work-order:delete'] },
  { key: 'participation', permissions: ['work-order:be-pic', 'work-order:be-worker', 'work-order:be-reviewer', 'work-order:be-overseer'] },
  { key: 'routineWork', permissions: ['work-list:manage', 'work-list:be-worker', 'work-list:receive-digest'] },
  { key: 'facilities', permissions: ['facilities:request', 'facilities:manage', 'facilities:default-approver'] },
  { key: 'administration', permissions: ['settings:manage', 'users:manage'] },
];

const managerPermissions = [
  'work-order:create',
  'work-order:read-all',
  'work-order:operate-any',
  'work-order:transition-any',
  'work-order:approve',
  'work-order:reopen',
  'work-order:cancel',
  'work-order:set-schedule',
  'work-order:manage-participants',
  'work-order:read-audit',
  'work-order:be-reviewer',
  'work-list:manage',
  'facilities:request',
  'facilities:manage',
] as const satisfies readonly Permission[];

// Ready-made lists to fill in with one click and to give the first administrator. Nothing is stored under these
// names and no code checks them; a person simply ends up with the permissions in the list.
export const permissionBundles = {
  administrator: [...managerPermissions, 'work-order:delete', 'settings:manage', 'users:manage'],
  facilitiesManager: [...managerPermissions, 'work-list:receive-digest', 'facilities:default-approver'],
  personInCharge: ['work-order:create', 'work-order:be-pic', 'facilities:request'],
  worker: ['work-order:be-worker', 'work-list:be-worker', 'facilities:request'],
  overseer: ['work-order:be-overseer', 'facilities:request'],
} as const satisfies Record<string, readonly Permission[]>;
export type PermissionBundle = keyof typeof permissionBundles;

export function can(granted: readonly Permission[] | undefined, permission: Permission): boolean {
  return Boolean(granted?.includes(permission));
}

export function canAny(granted: readonly Permission[] | undefined, wanted: readonly Permission[]): boolean {
  return wanted.some((permission) => can(granted, permission));
}

export function isPermission(value: unknown): value is Permission {
  return typeof value === 'string' && (permissions as readonly string[]).includes(value);
}
