import type { Db } from './store/schema.ts';
import type { Company, Source } from './types.ts';

export type Segment = 'small' | 'mid' | 'large';

export interface LeadRow {
  readonly company: string;
  readonly segment: Segment;
  readonly score: number;
  readonly goJavaOpen: number;
  readonly goOpen: number;
  readonly javaOpen: number;
  readonly new30d: number;
  readonly open90to365d: number;
  readonly open365dPlus: number;
  readonly reposted: number;
  readonly medianDaysOpen: number;
  /** Every open posting on the company board, any role and country: a rough size signal. */
  readonly boardPostings: number;
  readonly goJavaShare: number;
  readonly careersUrl: string;
  readonly sampleTitles: readonly string[];
}

const MS_PER_DAY = 86_400_000;
const MIN_GO_JAVA_OPEN = 3;
const NEW_DAYS = 30;
const STALE_DAYS = 90;
/** Past a year a posting is almost always an evergreen pipeline, not a role they struggle to fill. */
const EVERGREEN_DAYS = 365;
const NEW_WEIGHT = 2;
const REPOST_WEIGHT = 3;
const SMALL_BOARD = 100;
const MID_BOARD = 300;
const SAMPLE_TITLES = 3;

const BOARD_PAGES: Readonly<Record<Source, (token: string) => string>> = {
  greenhouse: (token) => `https://boards.greenhouse.io/${token}`,
  lever: (token) => `https://jobs.lever.co/${token}`,
  ashby: (token) => `https://jobs.ashbyhq.com/${token}`,
};

interface OpenJob {
  readonly title: string;
  readonly stacks: readonly string[];
  readonly ageDays: number;
  readonly reposted: boolean;
}

function loadOpenJobs(db: Db, company: Company, now: string): readonly OpenJob[] {
  return db
    .prepare(
      `SELECT title, stacks, original_posted_at, repost_count FROM jobs
        WHERE source = ? AND company = ? AND closed_at IS NULL AND region = 'us'
        ORDER BY original_posted_at DESC`,
    )
    .all(company.source, company.token)
    .map((row) => ({
      title: String(row.title),
      stacks: String(row.stacks).split(','),
      ageDays: Math.max(0, Math.floor((Date.parse(now) - Date.parse(String(row.original_posted_at))) / MS_PER_DAY)),
      reposted: Number(row.repost_count) > 0,
    }));
}

function latestBoardSize(db: Db, company: Company): number {
  const row = db
    .prepare('SELECT fetched FROM board_runs WHERE source = ? AND company = ? AND ok = 1 ORDER BY id DESC LIMIT 1')
    .get(company.source, company.token);
  return Number(row?.fetched ?? 0);
}

function median(values: readonly number[]): number {
  const sorted = values.toSorted((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  const upper = sorted[middle] ?? 0;
  return sorted.length % 2 === 1 ? upper : Math.round(((sorted[middle - 1] ?? 0) + upper) / 2);
}

function segmentFor(boardPostings: number): Segment {
  if (boardPostings < SMALL_BOARD) return 'small';
  return boardPostings < MID_BOARD ? 'mid' : 'large';
}

function count(jobs: readonly OpenJob[], keep: (job: OpenJob) => boolean): number {
  return jobs.filter(keep).length;
}

function toRow(db: Db, company: Company, now: string): LeadRow | null {
  const jobs = loadOpenJobs(db, company, now);
  if (jobs.length < MIN_GO_JAVA_OPEN) return null;
  const boardPostings = latestBoardSize(db, company);
  const new30d = count(jobs, (job) => job.ageDays <= NEW_DAYS);
  const open90to365d = count(jobs, (job) => job.ageDays > STALE_DAYS && job.ageDays <= EVERGREEN_DAYS);
  const reposted = count(jobs, (job) => job.reposted);
  return {
    company: company.name,
    segment: segmentFor(boardPostings),
    // Fresh roles show budget; roles stuck for months or reposted show they struggle to hire.
    score: new30d * NEW_WEIGHT + open90to365d + reposted * REPOST_WEIGHT,
    goJavaOpen: jobs.length,
    goOpen: count(jobs, (job) => job.stacks.includes('go')),
    javaOpen: count(jobs, (job) => job.stacks.includes('java')),
    new30d,
    open90to365d,
    open365dPlus: count(jobs, (job) => job.ageDays > EVERGREEN_DAYS),
    reposted,
    medianDaysOpen: median(jobs.map((job) => job.ageDays)),
    boardPostings,
    goJavaShare: boardPostings === 0 ? 0 : Math.round((jobs.length / boardPostings) * 100) / 100,
    careersUrl: BOARD_PAGES[company.source](company.token),
    sampleTitles: jobs.slice(0, SAMPLE_TITLES).map((job) => job.title),
  };
}

/** One row per company with enough open US Go/Java roles, highest score first. */
export function buildLeadReport(db: Db, companies: readonly Company[], now: string): readonly LeadRow[] {
  return companies
    .map((company) => toRow(db, company, now))
    .filter((row): row is LeadRow => row !== null)
    .toSorted((a, b) => b.score - a.score || b.goJavaOpen - a.goJavaOpen);
}

const CSV_COLUMNS: readonly (readonly [string, (row: LeadRow) => string | number])[] = [
  ['company', (row) => row.company],
  ['segment', (row) => row.segment],
  ['score', (row) => row.score],
  ['go_java_open', (row) => row.goJavaOpen],
  ['go_open', (row) => row.goOpen],
  ['java_open', (row) => row.javaOpen],
  ['new_30d', (row) => row.new30d],
  ['open_90_365d', (row) => row.open90to365d],
  ['open_365d_plus', (row) => row.open365dPlus],
  ['reposted', (row) => row.reposted],
  ['median_days_open', (row) => row.medianDaysOpen],
  ['board_postings', (row) => row.boardPostings],
  ['go_java_share', (row) => row.goJavaShare],
  ['careers_url', (row) => row.careersUrl],
  ['sample_titles', (row) => row.sampleTitles.join(' | ')],
];

/** Third-party text could start a spreadsheet formula, so such cells get a leading quote. */
function csvCell(value: string | number): string {
  if (typeof value === 'number') return String(value);
  const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return /[",\n\r]/.test(safe) || safe !== value ? `"${safe.replace(/"/g, '""')}"` : safe;
}

export function toCsv(rows: readonly LeadRow[]): string {
  const header = CSV_COLUMNS.map(([name]) => name).join(',');
  const lines = rows.map((row) => CSV_COLUMNS.map(([, read]) => csvCell(read(row))).join(','));
  return `${[header, ...lines].join('\n')}\n`;
}
