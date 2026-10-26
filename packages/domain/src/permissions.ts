import { roles, type Role } from './types.js';

// What a person may do. Roles are bundles of these (rolePermissions); the code asks for a permission, never a role.
export const permissions = [
  'work-order:create',
  'work-order:read-all',
  'work-order:manage',
  'work-order:delete',
  'work-order:be-pic',
  'work-order:be-worker',
  'work-order:be-reviewer',
  'work-order:be-overseer',
  'work-list:manage',
  'work-list:be-worker',
  'facilities:manage',
  'settings:manage',
  'users:manage',
] as const;
export type Permission = (typeof permissions)[number];

const managerPermissions = [
  'work-order:create',
  'work-order:read-all',
  'work-order:manage',
  'work-order:be-reviewer',
  'work-list:manage',
  'facilities:manage',
] as const satisfies readonly Permission[];

export const rolePermissions: Record<Role, readonly Permission[]> = {
  ADMINISTRATOR: [...managerPermissions, 'work-order:delete', 'settings:manage', 'users:manage'],
  FACILITIES_MANAGER: managerPermissions,
  PERSON_IN_CHARGE: ['work-order:create', 'work-order:be-pic'],
  WORKER: ['work-order:be-worker', 'work-list:be-worker'],
  OVERSEER: ['work-order:be-overseer'],
};

export function permissionsForRoles(userRoles: readonly Role[]): Permission[] {
  const granted = new Set<Permission>();
  for (const role of userRoles) for (const permission of rolePermissions[role] ?? []) granted.add(permission);
  return permissions.filter((permission) => granted.has(permission));
}

export function can(granted: readonly Permission[] | undefined, permission: Permission): boolean {
  return Boolean(granted?.includes(permission));
}

// For a place that only has the roles (a database row, an older client).
export function rolesCan(userRoles: readonly Role[], permission: Permission): boolean {
  return userRoles.some((role) => rolePermissions[role]?.includes(permission));
}

// The roles that hold a permission, for queries that filter in the database.
export function rolesWithPermission(permission: Permission): Role[] {
  return roles.filter((role) => rolePermissions[role].includes(permission));
}
