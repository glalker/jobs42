import { classify } from './classify.ts';
import { assessLiveness } from './liveness.ts';
import type { FetchBoard } from './sources/index.ts';
import { loadLivenessRows } from './store/read.ts';
import type { LivenessRow } from './store/read.ts';
import type { Db } from './store/schema.ts';
import { applySync, loadBoardJobs, recordRun, saveLiveness } from './store/write.ts';
import { planSync } from './sync.ts';
import type { ClassifiedJob, Company, Liveness } from './types.ts';

export interface IngestOptions {
  readonly db: Db;
  readonly companies: readonly Company[];
  readonly fetchBoard: FetchBoard;
  /** ISO timestamp the whole run is recorded under. */
  readonly now: string;
  readonly log: (line: string) => void;
  readonly concurrency?: number;
}

export interface IngestSummary {
  readonly boards: number;
  readonly failed: number;
  readonly inserted: number;
  readonly updated: number;
  readonly closed: number;
}

const DEFAULT_CONCURRENCY = 4;
/** Below this many open postings an age percentile says too little to be used. */
const MIN_PERCENTILE_SAMPLE = 20;
const EMPTY_SUMMARY: IngestSummary = { boards: 0, failed: 0, inserted: 0, updated: 0, closed: 0 };

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function syncBoard(options: IngestOptions, company: Company): Promise<IngestSummary> {
  const { db, now, log } = options;
  try {
    const board = await options.fetchBoard(company);
    const matched = board.map(classify).filter((job): job is ClassifiedJob => job !== null);
    const presentIds = new Set(board.map((job) => job.externalId));
    const stored = loadBoardJobs(db, company);
    if (board.length === 0 && stored.some((job) => job.closedAt === null)) {
      // An empty board is far more often a broken response than a company closing every role at once.
      throw new Error('board returned no postings while some are stored as open; left unchanged');
    }
    const plan = planSync(stored, matched, presentIds, now);
    applySync(db, company, plan, { at: now, fetched: board.length, matched: matched.length, error: null });
    log(`${company.source}/${company.token}: ${board.length} postings, ${matched.length} Go/Java, +${plan.inserts.length} new, ${plan.closes.length} closed`);
    return {
      boards: 1,
      failed: 0,
      inserted: plan.inserts.length,
      updated: plan.updates.filter((update) => update.changes.length > 0).length,
      closed: plan.closes.length,
    };
  } catch (error) {
    const message = describeError(error);
    // A board we could not read tells us nothing about its postings, so they stay as they are.
    recordRun(db, company, { at: now, fetched: 0, matched: 0, error: message });
    log(`${company.source}/${company.token}: FAILED, ${message}`);
    return { ...EMPTY_SUMMARY, boards: 1, failed: 1 };
  }
}

function addSummaries(a: IngestSummary, b: IngestSummary): IngestSummary {
  return {
    boards: a.boards + b.boards,
    failed: a.failed + b.failed,
    inserted: a.inserted + b.inserted,
    updated: a.updated + b.updated,
    closed: a.closed + b.closed,
  };
}

function inBatches<T>(items: readonly T[], size: number): readonly (readonly T[])[] {
  return Array.from({ length: Math.ceil(items.length / size) }, (_, i) => items.slice(i * size, (i + 1) * size));
}

/** Share of open postings that are younger than the given one. */
function agePercentile(openDates: readonly number[], postedAt: string): number | null {
  if (openDates.length < MIN_PERCENTILE_SAMPLE) return null;
  const time = Date.parse(postedAt);
  return openDates.filter((other) => other > time).length / openDates.length;
}

export function rateAll(rows: readonly LivenessRow[], now: string): ReadonlyMap<number, Liveness> {
  const openDates = rows.filter((row) => row.closedAt === null).map((row) => Date.parse(row.originalPostedAt));
  return new Map(
    rows.map((row) => [row.id, assessLiveness({ ...row, now, agePercentile: agePercentile(openDates, row.originalPostedAt) })]),
  );
}

/** Reads every company board, records what changed, then re-rates every posting. */
export async function runIngest(options: IngestOptions): Promise<IngestSummary> {
  const batches = inBatches(options.companies, options.concurrency ?? DEFAULT_CONCURRENCY);
  let summary = EMPTY_SUMMARY;
  for (const batch of batches) {
    const results = await Promise.all(batch.map((company) => syncBoard(options, company)));
    summary = results.reduce(addSummaries, summary);
  }
  saveLiveness(options.db, rateAll(loadLivenessRows(options.db), options.now));
  return summary;
}
