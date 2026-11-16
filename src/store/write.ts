import type { JobInsert, JobUpdate, SyncPlan } from '../sync.ts';
import type { Company, Liveness, StoredJob } from '../types.ts';
import { inTransaction } from './schema.ts';
import type { Db } from './schema.ts';

export interface BoardRun {
  readonly at: string;
  readonly fetched: number;
  readonly matched: number;
  readonly error: string | null;
}

/** Every posting ever stored for one board, open or closed. */
export function loadBoardJobs(db: Db, company: Company): readonly StoredJob[] {
  const rows = db
    .prepare(
      `SELECT id, external_id, title, title_key, location, description, content_hash, salary, repost_of,
              first_seen_at, closed_at, repost_count, original_posted_at
         FROM jobs WHERE source = ? AND company = ?`,
    )
    .all(company.source, company.token);
  return rows.map((row) => ({
    id: Number(row.id),
    externalId: String(row.external_id),
    title: String(row.title),
    titleKey: String(row.title_key),
    location: String(row.location),
    repostOf: row.repost_of === null ? null : Number(row.repost_of),
    description: String(row.description),
    contentHash: String(row.content_hash),
    salary: row.salary === null ? null : String(row.salary),
    firstSeenAt: String(row.first_seen_at),
    closedAt: row.closed_at === null ? null : String(row.closed_at),
    repostCount: Number(row.repost_count),
    originalPostedAt: String(row.original_posted_at),
  }));
}

function addEvent(db: Db, jobId: number, at: string, kind: string, detail: string | null): void {
  db.prepare('INSERT INTO job_events (job_id, at, kind, detail) VALUES (?, ?, ?, ?)').run(jobId, at, kind, detail);
}

function closeJob(db: Db, id: number, now: string): void {
  db.prepare('UPDATE jobs SET closed_at = ? WHERE id = ?').run(now, id);
  addEvent(db, id, now, 'closed', null);
}

function updateJob(db: Db, update: JobUpdate, now: string): void {
  const { job } = update;
  db.prepare(
    `UPDATE jobs
        SET url = ?, title = ?, title_key = ?, location = ?, region = ?, remote = ?, stacks = ?,
            salary = ?, description = ?, content_hash = ?, last_seen_at = ?, closed_at = NULL
      WHERE id = ?`,
  ).run(
    job.url,
    job.title,
    job.titleKey,
    job.location,
    job.region,
    job.remote ? 1 : 0,
    job.stacks.join(','),
    job.salary,
    job.description,
    job.contentHash,
    now,
    update.id,
  );
  update.changes.forEach((change) => addEvent(db, update.id, now, change, null));
}

function insertJob(db: Db, insert: JobInsert, now: string): void {
  const { job } = insert;
  const result = db
    .prepare(
      `INSERT INTO jobs (source, company, company_name, external_id, url, title, title_key, location, region,
                         remote, stacks, salary, description, content_hash, posted_at, original_posted_at,
                         first_seen_at, last_seen_at, repost_of, repost_count)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      job.source,
      job.company,
      job.companyName,
      job.externalId,
      job.url,
      job.title,
      job.titleKey,
      job.location,
      job.region,
      job.remote ? 1 : 0,
      job.stacks.join(','),
      job.salary,
      job.description,
      job.contentHash,
      job.postedAt,
      insert.originalPostedAt,
      now,
      now,
      insert.repostOf,
      insert.repostCount,
    );
  const reposted = insert.repostOf !== null;
  const detail = reposted ? `Same opening as posting #${insert.repostOf}` : null;
  addEvent(db, Number(result.lastInsertRowid), now, reposted ? 'reposted' : 'published', detail);
}

/** Writes one board's sync plan and its run record atomically. */
export function applySync(db: Db, company: Company, plan: SyncPlan, run: BoardRun): void {
  inTransaction(db, () => {
    plan.closes.forEach((id) => closeJob(db, id, run.at));
    plan.updates.forEach((update) => updateJob(db, update, run.at));
    plan.inserts.forEach((insert) => insertJob(db, insert, run.at));
    recordRun(db, company, run);
  });
}

export function recordRun(db: Db, company: Company, run: BoardRun): void {
  db.prepare('INSERT INTO board_runs (source, company, at, ok, fetched, matched, error) VALUES (?, ?, ?, ?, ?, ?, ?)').run(
    company.source,
    company.token,
    run.at,
    run.error === null ? 1 : 0,
    run.fetched,
    run.matched,
    run.error,
  );
}

export function saveLiveness(db: Db, verdicts: ReadonlyMap<number, Liveness>): void {
  const statement = db.prepare(
    'UPDATE jobs SET liveness_verdict = ?, liveness_score = ?, liveness_signals = ? WHERE id = ?',
  );
  inTransaction(db, () => {
    verdicts.forEach((liveness, id) => {
      statement.run(liveness.verdict, liveness.score, JSON.stringify(liveness.signals), id);
    });
  });
}
