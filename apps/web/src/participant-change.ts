import type { Locale } from './i18n';

type Person = { id: string; name: string };
type ParticipantState = { assigneeIds?: unknown; reviewerId?: unknown; overseerIds?: unknown };
type ParticipantChanges = {
  pics?: { added?: unknown; removed?: unknown };
  reviewer?: { previous?: unknown; next?: unknown };
  overseers?: { added?: unknown; removed?: unknown };
};

function people(value: unknown): Person[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== 'object') return [];
    const record = item as Record<string, unknown>;
    return typeof record.id === 'string' && typeof record.name === 'string' ? [{ id: record.id, name: record.name }] : [];
  });
}

function ids(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

function person(value: unknown): Person | null {
  if (!value || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;
  return typeof record.id === 'string' && typeof record.name === 'string' ? { id: record.id, name: record.name } : null;
}

export function formatParticipantChanges(
  structuredData: Record<string, unknown>,
  users: Array<{ id: string; full_name: string }>,
  locale: Locale,
): string[] {
  const copy = locale === 'id'
    ? { added: 'Ditambahkan ke', removed: 'Dihapus dari', reviewerChanged: 'Peninjau diubah', reviewerAdded: 'Peninjau ditetapkan', reviewerRemoved: 'Peninjau dihapus', pic: 'PIC', overseer: 'Pengawas', from: 'dari', to: 'menjadi' }
    : { added: 'Added to', removed: 'Removed from', reviewerChanged: 'Reviewer changed', reviewerAdded: 'Reviewer assigned', reviewerRemoved: 'Reviewer removed', pic: 'PIC', overseer: 'Overseers', from: 'from', to: 'to' };
  const namesById = new Map(users.map((user) => [user.id, user.full_name]));
  const name = (id: string) => namesById.get(id) ?? id;
  const details: string[] = [];
  const explicit = structuredData.changes as ParticipantChanges | undefined;

  if (explicit && typeof explicit === 'object') {
    for (const added of people(explicit.pics?.added)) details.push(`${copy.added} ${copy.pic}: ${added.name}`);
    for (const removed of people(explicit.pics?.removed)) details.push(`${copy.removed} ${copy.pic}: ${removed.name}`);
    for (const added of people(explicit.overseers?.added)) details.push(`${copy.added} ${copy.overseer}: ${added.name}`);
    for (const removed of people(explicit.overseers?.removed)) details.push(`${copy.removed} ${copy.overseer}: ${removed.name}`);
    const previousReviewer = person(explicit.reviewer?.previous);
    const nextReviewer = person(explicit.reviewer?.next);
    if (previousReviewer?.id !== nextReviewer?.id) {
      if (previousReviewer && nextReviewer) details.push(`${copy.reviewerChanged} ${copy.from} ${previousReviewer.name} ${copy.to} ${nextReviewer.name}`);
      else if (nextReviewer) details.push(`${copy.reviewerAdded}: ${nextReviewer.name}`);
      else if (previousReviewer) details.push(`${copy.reviewerRemoved}: ${previousReviewer.name}`);
    }
    return details;
  }

  const previous = (structuredData.previous ?? {}) as ParticipantState;
  const next = (structuredData.next ?? {}) as ParticipantState;
  const previousPics = ids(previous.assigneeIds);
  const nextPics = ids(next.assigneeIds);
  const previousOverseers = ids(previous.overseerIds);
  const nextOverseers = ids(next.overseerIds);
  for (const id of nextPics.filter((userId) => !previousPics.includes(userId))) details.push(`${copy.added} ${copy.pic}: ${name(id)}`);
  for (const id of previousPics.filter((userId) => !nextPics.includes(userId))) details.push(`${copy.removed} ${copy.pic}: ${name(id)}`);
  for (const id of nextOverseers.filter((userId) => !previousOverseers.includes(userId))) details.push(`${copy.added} ${copy.overseer}: ${name(id)}`);
  for (const id of previousOverseers.filter((userId) => !nextOverseers.includes(userId))) details.push(`${copy.removed} ${copy.overseer}: ${name(id)}`);
  const previousReviewerId = typeof previous.reviewerId === 'string' ? previous.reviewerId : null;
  const nextReviewerId = typeof next.reviewerId === 'string' ? next.reviewerId : null;
  if (previousReviewerId !== nextReviewerId) {
    if (previousReviewerId && nextReviewerId) details.push(`${copy.reviewerChanged} ${copy.from} ${name(previousReviewerId)} ${copy.to} ${name(nextReviewerId)}`);
    else if (nextReviewerId) details.push(`${copy.reviewerAdded}: ${name(nextReviewerId)}`);
    else if (previousReviewerId) details.push(`${copy.reviewerRemoved}: ${name(previousReviewerId)}`);
  }
  return details;
}
