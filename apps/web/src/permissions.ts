import { can, permissionsForRoles, rolesCan, type Permission, type Role } from '@woko/domain';
import type { CurrentUser } from './types';

// The server sends the permissions with the session; an older answer without them falls back to the roles.
export function userCan(user: CurrentUser, permission: Permission): boolean {
  return can(user.permissions ?? permissionsForRoles(user.roles), permission);
}

// For the people in a pick list, who only have their roles.
export function rolesHave(roles: readonly Role[], permission: Permission): boolean {
  return rolesCan(roles, permission);
}
