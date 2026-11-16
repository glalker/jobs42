import type { LivenessFacts } from '../liveness.ts';
import type { Liveness, Region, Signal, Source, Stack, Verdict } from '../types.ts';
import type { Db } from './schema.ts';

export interface JobFilter {
  readonly stack?: Stack;
  readonly region: 'us' | 'all';
  /** Hide postings rated "unlikely". */
  readonly liveOnly: boolean;
  readonly includeClosed: boolean;
  readonly remoteOnly?: boolean;
  readonly q?: string;
  readonly limit: number;
  readonly offset: number;
}

export interface JobSummary {
  readonly id: number;
  readonly companyName: string;
  readonly title: string;
  readonly url: string;
  readonly location: string;
  readonly region: Region;
  readonly remote: boolean;
  readonly stacks: readonly Stack[];
  readonly salary: string | null;
  /** Earliest publication across the repost chain. */
  readonly postedAt: string;
  readonly closedAt: string | null;
  readonly repostCount: number;
  readonly liveness: Liveness;
}

export interface JobDetail extends JobSummary {
  readonly source: Source;
  readonly description: string;
  readonly firstSeenAt: string;
  readonly lastSeenAt: string;
  readonly repostOf: number | null;
}

export interface JobEvent {
  readonly at: string;
  readonly kind: string;
  readonly detail: string | null;
}

export interface Stats {
  readonly openJobs: number;
  readonly companies: number;
  readonly lastRunAt: string | null;
}

type Row = Record<string, unknown>;
type SqlValue = string | number;

const SUMMARY_COLUMNS = `id, company_name, title, url, location, region, remote, stacks, salary,
  original_posted_at, closed_at, repost_count, liveness_verdict, liveness_score, liveness_signals`;

function nullableText(value: unknown): string | null {
  return value === null || value === undefined ? null : String(value);
}

function parseSignals(value: unknown): readonly Signal[] {
  const parsed: unknown = JSON.parse(String(value));
  return Array.isArray(parsed) ? (parsed as readonly Signal[]) : [];
}

function toSummary(row: Row): JobSummary {
  return {
    id: Number(row.id),
    companyName: String(row.company_name),
    title: String(row.title),
    url: String(row.url),
    location: String(row.location),
    region: String(row.region) as Region,
    remote: Number(row.remote) === 1,
    stacks: String(row.stacks).split(',').filter((stack) => stack.length > 0) as Stack[],
    salary: nullableText(row.salary),
    postedAt: String(row.original_posted_at),
    closedAt: nullableText(row.closed_at),
    repostCount: Number(row.repost_count),
    liveness: {
      verdict: String(row.liveness_verdict) as Verdict,
      score: row.liveness_score === null ? null : Number(row.liveness_score),
      signals: parseSignals(row.liveness_signals),
    },
  };
}

function escapeLike(text: string): string {
  return text.replace(/[\\%_]/g, (char) => `\\${char}`);
}

interface Where {
  readonly sql: string;
  readonly params: readonly SqlValue[];
}

function buildWhere(filter: JobFilter): Where {
  const search = filter.q === undefined || filter.q.trim() === '' ? null : `%${escapeLike(filter.q.trim())}%`;
  const clauses: readonly (Where | null)[] = [
    filter.includeClosed ? null : { sql: 'closed_at IS NULL', params: [] },
    filter.region === 'us' ? { sql: "region = 'us'", params: [] } : null,
    filter.liveOnly ? { sql: "liveness_verdict <> 'unlikely'", params: [] } : null,
    filter.remoteOnly === true ? { sql: 'remote = 1', params: [] } : null,
    filter.stack === undefined ? null : { sql: "(',' || stacks || ',') LIKE ?", params: [`%,${filter.stack},%`] },
    search === null
      ? null
      : { sql: "(title LIKE ? ESCAPE '\\' OR company_name LIKE ? ESCAPE '\\')", params: [search, search] },
  ];
  const active = clauses.filter((clause): clause is Where => clause !== null);
  return {
    sql: active.length === 0 ? '' : `WHERE ${active.map((clause) => clause.sql).join(' AND ')}`,
    params: active.flatMap((clause) => clause.params),
  };
}

/** One page of the feed, newest publication first, with the total for pagination. */
export function listJobs(db: Db, filter: JobFilter): { readonly jobs: readonly JobSummary[]; readonly total: number } {
  const where = buildWhere(filter);
  const rows = db
    .prepare(`SELECT ${SUMMARY_COLUMNS} FROM jobs ${where.sql} ORDER BY original_posted_at DESC, id DESC LIMIT ? OFFSET ?`)
    .all(...where.params, filter.limit, filter.offset);
  const count = db.prepare(`SELECT COUNT(*) AS total FROM jobs ${where.sql}`).get(...where.params);
  return { jobs: rows.map(toSummary), total: Number(count?.total ?? 0) };
}

export function getJob(db: Db, id: number): JobDetail | null {
  const row = db
    .prepare(`SELECT ${SUMMARY_COLUMNS}, source, description, first_seen_at, last_seen_at, repost_of FROM jobs WHERE id = ?`)
    .get(id);
  if (row === undefined) return null;
  return {
    ...toSummary(row),
    source: String(row.source) as Source,
    description: String(row.description),
    firstSeenAt: String(row.first_seen_at),
    lastSeenAt: String(row.last_seen_at),
    repostOf: row.repost_of === null ? null : Number(row.repost_of),
  };
}

export function listEvents(db: Db, jobId: number): readonly JobEvent[] {
  return db
    .prepare('SELECT at, kind, detail FROM job_events WHERE job_id = ? ORDER BY id')
    .all(jobId)
    .map((row) => ({ at: String(row.at), kind: String(row.kind), detail: nullableText(row.detail) }));
}

export function getStats(db: Db): Stats {
  const jobs = db
    .prepare('SELECT COUNT(*) AS open_jobs, COUNT(DISTINCT source || \'/\' || company) AS companies FROM jobs WHERE closed_at IS NULL')
    .get();
  const run = db.prepare('SELECT MAX(at) AS last_run_at FROM board_runs').get();
  return {
    openJobs: Number(jobs?.open_jobs ?? 0),
    companies: Number(jobs?.companies ?? 0),
    lastRunAt: nullableText(run?.last_run_at),
  };
}

export type LivenessRow = Omit<LivenessFacts, 'now' | 'agePercentile'> & { readonly id: number };

/** Everything the liveness rules need for every stored posting, except the cross-posting percentile. */
export function loadLivenessRows(db: Db): readonly LivenessRow[] {
  const rows = db
    .prepare(
      `SELECT j.id, j.title, j.posted_at, j.original_posted_at, j.first_seen_at, j.closed_at, j.repost_count,
              COUNT(e.id) AS text_changes, MAX(e.at) AS last_text_change
         FROM jobs j
         LEFT JOIN job_events e ON e.job_id = j.id AND e.kind = 'text_changed'
        GROUP BY j.id`,
    )
    .all();
  return rows.map((row) => ({
    id: Number(row.id),
    title: String(row.title),
    postedAtKnown: row.posted_at !== null || Number(row.repost_count) > 0,
    originalPostedAt: String(row.original_posted_at),
    firstSeenAt: String(row.first_seen_at),
    closedAt: nullableText(row.closed_at),
    repostCount: Number(row.repost_count),
    textChangeCount: Number(row.text_changes),
    lastTextChangeAt: nullableText(row.last_text_change),
  }));
}
