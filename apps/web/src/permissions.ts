import { can, type Permission } from '@woko/domain';

// Anyone with a list of permissions: the signed-in user, or a person in a pick list.
export function userCan(user: { permissions: readonly Permission[] }, permission: Permission): boolean {
  return can(user.permissions, permission);
}
