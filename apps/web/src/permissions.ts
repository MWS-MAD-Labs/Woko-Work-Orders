import { canAny, can, facilitiesViewPermissions, workListViewPermissions, workOrderViewPermissions, type Permission } from '@woko/domain';

// Anyone with a list of permissions: the signed-in user, or a person in a pick list.
export function userCan(user: { permissions: readonly Permission[] }, permission: Permission): boolean {
  return can(user.permissions, permission);
}

export type PrimaryPage = 'work-orders' | 'work-lists' | 'facilities';

// The main tabs a person may open, in the order they are shown. Someone who can only create work orders still gets
// the Work Orders tab for the create button.
export function visiblePrimaryPages(user: { permissions: readonly Permission[] }): PrimaryPage[] {
  const pages: PrimaryPage[] = [];
  if (canAny(user.permissions, [...workOrderViewPermissions, 'work-order.create'])) pages.push('work-orders');
  if (canAny(user.permissions, workListViewPermissions)) pages.push('work-lists');
  if (canAny(user.permissions, facilitiesViewPermissions)) pages.push('facilities');
  return pages;
}

// The tab to show: the one asked for when it is allowed, otherwise the first allowed one, otherwise none.
export function activePrimaryPage(pages: readonly PrimaryPage[], requested: PrimaryPage): PrimaryPage | null {
  return pages.includes(requested) ? requested : pages[0] ?? null;
}
