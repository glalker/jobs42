import { collapseWhitespace, textSimilarity } from './text.ts';
import type { ClassifiedJob, StoredJob } from './types.ts';

export type Change = 'reopened' | 'title_changed' | 'text_changed' | 'salary_changed';

export interface JobInsert {
  readonly job: ClassifiedJob;
  readonly repostOf: number | null;
  readonly repostCount: number;
  readonly originalPostedAt: string;
}

export interface JobUpdate {
  readonly id: number;
  readonly job: ClassifiedJob;
  readonly changes: readonly Change[];
}

export interface SyncPlan {
  readonly inserts: readonly JobInsert[];
  readonly updates: readonly JobUpdate[];
  readonly closes: readonly number[];
}

/** Same title plus this much shared wording means the same opening under a new link. */
const REPOST_SIMILARITY = 0.8;
/** A posting that returns after longer than this is treated as a new opening, not a repost. */
const REPOST_WINDOW_DAYS = 180;
const MS_PER_DAY = 86_400_000;

function detectChanges(before: StoredJob, after: ClassifiedJob): readonly Change[] {
  return [
    ...(before.closedAt !== null ? (['reopened'] as const) : []),
    ...(before.title !== after.title ? (['title_changed'] as const) : []),
    ...(collapseWhitespace(before.description) !== collapseWhitespace(after.description)
      ? (['text_changed'] as const)
      : []),
    ...(before.salary !== after.salary ? (['salary_changed'] as const) : []),
  ];
}

function closedRecently(job: StoredJob, now: string): boolean {
  const closedAt = job.closedAt ?? now;
  return Date.parse(now) - Date.parse(closedAt) <= REPOST_WINDOW_DAYS * MS_PER_DAY;
}

function isRepostOf(candidate: StoredJob, job: ClassifiedJob): boolean {
  return (
    candidate.titleKey === job.titleKey &&
    candidate.location === job.location &&
    textSimilarity(candidate.description, job.description) >= REPOST_SIMILARITY
  );
}

function earliest(first: string, second: string): string {
  return Date.parse(first) <= Date.parse(second) ? first : second;
}

function toInsert(job: ClassifiedJob, predecessor: StoredJob | undefined, now: string): JobInsert {
  const ownDate = job.postedAt ?? now;
  if (predecessor === undefined) {
    return { job, repostOf: null, repostCount: 0, originalPostedAt: ownDate };
  }
  return {
    job,
    repostOf: predecessor.id,
    repostCount: predecessor.repostCount + 1,
    originalPostedAt: earliest(predecessor.originalPostedAt, ownDate),
  };
}

/**
 * Compares one company's stored postings with what its board returns now.
 * A posting closes when it leaves the board or when an edit takes it out of the Go/Java filter.
 * `presentIds` holds every id on the board, including postings outside the filter: one that is
 * still on the board has not been taken down, so it can never be the origin of a repost.
 */
export function planSync(
  existing: readonly StoredJob[],
  fetched: readonly ClassifiedJob[],
  presentIds: ReadonlySet<string>,
  now: string,
): SyncPlan {
  const byExternalId = new Map(existing.map((job) => [job.externalId, job]));
  const fetchedIds = new Set(fetched.map((job) => job.externalId));
  const closes = existing
    .filter((job) => job.closedAt === null && !fetchedIds.has(job.externalId))
    .map((job) => job.id);

  const updates = fetched.flatMap((job): JobUpdate[] => {
    const before = byExternalId.get(job.externalId);
    return before === undefined ? [] : [{ id: before.id, job, changes: detectChanges(before, job) }];
  });

  // A posting that already has a successor is not a candidate, so a chain never forks.
  const succeeded = new Set(existing.map((job) => job.repostOf).filter((id): id is number => id !== null));
  const predecessors = existing
    .filter((job) => !presentIds.has(job.externalId) && !succeeded.has(job.id) && closedRecently(job, now))
    .toSorted((a, b) => b.repostCount - a.repostCount || Date.parse(b.firstSeenAt) - Date.parse(a.firstSeenAt));

  const { inserts } = fetched
    .filter((job) => !byExternalId.has(job.externalId))
    .reduce<{ inserts: readonly JobInsert[]; claimed: ReadonlySet<number> }>(
      (acc, job) => {
        const predecessor = predecessors.find((candidate) => !acc.claimed.has(candidate.id) && isRepostOf(candidate, job));
        return {
          inserts: [...acc.inserts, toInsert(job, predecessor, now)],
          claimed: predecessor === undefined ? acc.claimed : new Set([...acc.claimed, predecessor.id]),
        };
      },
      { inserts: [], claimed: new Set() },
    );

  return { inserts, updates, closes };
}
