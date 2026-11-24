import { describe, expect, it } from 'vitest';
import { permissionBundles } from '@woko/domain';
import { activePrimaryPage, userCan, visiblePrimaryPages } from './permissions';

describe('userCan', () => {
  it('answers from the permissions the person holds', () => {
    expect(userCan({ permissions: ['work-order.approve'] }, 'work-order.approve')).toBe(true);
    expect(userCan({ permissions: [] }, 'work-order.create')).toBe(false);
  });

  it('works for a person in a pick list the same way', () => {
    expect(userCan({ permissions: permissionBundles.worker }, 'work-order.be-worker')).toBe(true);
    expect(userCan({ permissions: permissionBundles.overseer }, 'work-order.be-worker')).toBe(false);
  });
});

describe('visiblePrimaryPages', () => {
  const pagesFor = (permissions: string[]) => visiblePrimaryPages({ permissions: permissions as never });

  it('shows only Facilities to someone who can only request equipment', () => {
    expect(pagesFor(['woko.use', 'facilities.request'])).toEqual(['facilities']);
  });

  it('shows Routine Work to a reader or a worker of it, and nothing else', () => {
    expect(pagesFor(['woko.use', 'work-list.read'])).toEqual(['work-lists']);
    expect(pagesFor(['woko.use', 'work-list.be-worker'])).toEqual(['work-lists']);
  });

  it('shows Work Orders to anyone who can see them, and to someone who can only create them', () => {
    for (const permission of ['work-order.read-all', 'work-order.operate-any', 'work-order.be-pic', 'work-order.be-worker', 'work-order.be-reviewer', 'work-order.be-overseer', 'work-order.create']) {
      expect(pagesFor(['woko.use', permission])).toEqual(['work-orders']);
    }
  });

  it('shows Facilities to someone who can read or manage bookings without requesting', () => {
    expect(pagesFor(['woko.use', 'facilities.read'])).toEqual(['facilities']);
    expect(pagesFor(['woko.use', 'facilities.read', 'facilities.manage'])).toEqual(['facilities']);
  });

  it('follows the permissions of the ready-made lists', () => {
    expect(visiblePrimaryPages({ permissions: permissionBundles.administrator })).toEqual(['work-orders', 'work-lists', 'facilities']);
    expect(visiblePrimaryPages({ permissions: permissionBundles.personInCharge })).toEqual(['work-orders', 'facilities']);
    expect(visiblePrimaryPages({ permissions: permissionBundles.worker })).toEqual(['work-orders', 'work-lists', 'facilities']);
    expect(visiblePrimaryPages({ permissions: permissionBundles.overseer })).toEqual(['work-orders', 'facilities']);
  });

  it('shows nothing to someone who may only sign in', () => {
    expect(pagesFor(['woko.use'])).toEqual([]);
    expect(pagesFor([])).toEqual([]);
  });
});

describe('activePrimaryPage', () => {
  it('keeps the page asked for when it is allowed', () => {
    expect(activePrimaryPage(['work-orders', 'facilities'], 'facilities')).toBe('facilities');
  });

  it('falls back to the first allowed page when the one asked for is not', () => {
    expect(activePrimaryPage(['facilities'], 'work-orders')).toBe('facilities');
    expect(activePrimaryPage(['work-lists', 'facilities'], 'work-orders')).toBe('work-lists');
  });

  it('is none when nothing is allowed', () => {
    expect(activePrimaryPage([], 'work-orders')).toBeNull();
  });
});

