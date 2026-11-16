import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseCompanies } from '../src/companies.ts';
import { runIngest } from '../src/ingest.ts';
import type { FetchBoard } from '../src/sources/index.ts';
import { getJob, getStats, listEvents, listJobs } from '../src/store/read.ts';
import type { JobFilter } from '../src/store/read.ts';
import { openDatabase } from '../src/store/schema.ts';
import type { Company, RawJob } from '../src/types.ts';

const ACME: Company = { source: 'greenhouse', token: 'acme', name: 'Acme' };
const GLOBEX: Company = { source: 'lever', token: 'globex', name: 'Globex' };
const DAY_1 = '2026-11-01T12:00:00.000Z';
const DAY_2 = '2026-11-02T12:00:00.000Z';
const GO_TEXT = Array.from({ length: 30 }, (_, i) => `Duty ${i}: build payment services in Go`).join('. ');
const ANY: JobFilter = { region: 'all', liveOnly: false, includeClosed: true, limit: 50, offset: 0 };
const silent = (): void => {};

const posting = (overrides: Partial<RawJob> = {}): RawJob => ({
  source: 'greenhouse',
  company: 'acme',
  companyName: 'Acme',
  externalId: '1',
  url: 'https://acme.test/jobs/1',
  title: 'Senior Backend Engineer',
  locations: ['New York, NY'],
  countryHints: [],
  remote: false,
  postedAt: '2026-10-25T00:00:00.000Z',
  description: GO_TEXT,
  salary: null,
  ...overrides,
});

const boards = (byToken: Readonly<Record<string, readonly RawJob[] | Error>>): FetchBoard => async (company) => {
  const board = byToken[company.token];
  if (board === undefined || board instanceof Error) throw board ?? new Error('unknown board');
  return board;
};

test('the first run stores only Go and Java engineering postings and rates them', async () => {
  const db = openDatabase(':memory:');
  const fetchBoard = boards({
    acme: [
      posting(),
      posting({ externalId: '2', title: 'Account Executive', description: 'Sell to Java teams.' }),
      posting({ externalId: '3', title: 'Frontend Engineer', description: 'React and TypeScript.' }),
    ],
  });

  const summary = await runIngest({ db, companies: [ACME], fetchBoard, now: DAY_1, log: silent });

  const { jobs, total } = listJobs(db, ANY);
  assert.deepEqual(summary, { boards: 1, failed: 0, inserted: 1, updated: 0, closed: 0 });
  assert.equal(total, 1);
  assert.equal(jobs[0]?.title, 'Senior Backend Engineer');
  assert.deepEqual(jobs[0]?.stacks, ['go']);
  assert.equal(jobs[0]?.liveness.verdict, 'hiring');
  assert.deepEqual(getStats(db), { openJobs: 1, companies: 1, lastRunAt: DAY_1 });
});

test('a posting that returns under a new link is closed, linked and penalised as a repost', async () => {
  const db = openDatabase(':memory:');
  await runIngest({ db, companies: [ACME], fetchBoard: boards({ acme: [posting()] }), now: DAY_1, log: silent });
  const reposted = posting({ externalId: '9', url: 'https://acme.test/jobs/9', postedAt: DAY_2 });

  const summary = await runIngest({ db, companies: [ACME], fetchBoard: boards({ acme: [reposted] }), now: DAY_2, log: silent });

  const { jobs } = listJobs(db, { ...ANY, includeClosed: false });
  const current = jobs[0];
  assert.deepEqual(summary, { boards: 1, failed: 0, inserted: 1, updated: 0, closed: 1 });
  assert.equal(jobs.length, 1);
  assert.equal(current?.repostCount, 1);
  assert.equal(current?.postedAt, '2026-10-25T00:00:00.000Z');
  assert.ok(current?.liveness.signals.some((signal) => /Reposted once/.test(signal.text)));
  assert.deepEqual(listEvents(db, current?.id ?? 0).map((event) => event.kind), ['reposted']);

  const original = getJob(db, getJob(db, current?.id ?? 0)?.repostOf ?? 0);
  assert.equal(original?.closedAt, DAY_2);
  assert.equal(original?.liveness.verdict, 'closed');
  assert.deepEqual(listEvents(db, original?.id ?? 0).map((event) => event.kind), ['published', 'closed']);
});

test('an edited description is recorded as an event and counts as a sign of life', async () => {
  const db = openDatabase(':memory:');
  await runIngest({ db, companies: [ACME], fetchBoard: boards({ acme: [posting()] }), now: DAY_1, log: silent });
  const edited = posting({ description: `${GO_TEXT}. We now also run Kafka.`, salary: '$180K - $220K' });

  await runIngest({ db, companies: [ACME], fetchBoard: boards({ acme: [edited] }), now: DAY_2, log: silent });

  const job = listJobs(db, ANY).jobs[0];
  assert.equal(job?.salary, '$180K - $220K');
  assert.match(getJob(db, job?.id ?? 0)?.description ?? '', /Kafka/);
  assert.deepEqual(listEvents(db, job?.id ?? 0).map((event) => event.kind), ['published', 'text_changed', 'salary_changed']);
  assert.ok(job?.liveness.signals.some((signal) => /Description updated/.test(signal.text)));
});

test('a board that fails to load keeps its postings open and is reported as failed', async () => {
  const db = openDatabase(':memory:');
  await runIngest({ db, companies: [ACME], fetchBoard: boards({ acme: [posting()] }), now: DAY_1, log: silent });
  const logged: string[] = [];

  const summary = await runIngest({
    db,
    companies: [ACME],
    fetchBoard: boards({ acme: new Error('HTTP 503') }),
    now: DAY_2,
    log: (line) => logged.push(line),
  });

  assert.deepEqual(summary, { boards: 1, failed: 1, inserted: 0, updated: 0, closed: 0 });
  assert.equal(listJobs(db, { ...ANY, includeClosed: false }).total, 1);
  assert.ok(logged.some((line) => /acme/.test(line) && /HTTP 503/.test(line)));
});

test('an empty board is treated as a failed read, not as every posting closing', async () => {
  const db = openDatabase(':memory:');
  await runIngest({ db, companies: [ACME], fetchBoard: boards({ acme: [posting()] }), now: DAY_1, log: silent });

  const summary = await runIngest({ db, companies: [ACME], fetchBoard: boards({ acme: [] }), now: DAY_2, log: silent });

  assert.equal(summary.failed, 1);
  assert.equal(summary.closed, 0);
  assert.equal(listJobs(db, { ...ANY, includeClosed: false }).total, 1);
});

test('a posting edited out of Go and Java leaves the feed', async () => {
  const db = openDatabase(':memory:');
  await runIngest({ db, companies: [ACME], fetchBoard: boards({ acme: [posting()] }), now: DAY_1, log: silent });
  const rewritten = posting({ description: 'Now a Ruby on Rails role.' });

  await runIngest({ db, companies: [ACME], fetchBoard: boards({ acme: [rewritten] }), now: DAY_2, log: silent });

  assert.equal(listJobs(db, { ...ANY, includeClosed: false }).total, 0);
});

test('listJobs filters by stack, region, liveness and search text', async () => {
  const db = openDatabase(':memory:');
  const fetchBoard = boards({
    acme: [
      posting(),
      posting({ externalId: '2', title: 'Java Developer', description: 'Java and Spring.', locations: ['Berlin'] }),
      posting({ externalId: '3', title: 'Staff Engineer', postedAt: '2025-11-01T00:00:00.000Z' }),
    ],
    globex: [posting({ source: 'lever', company: 'globex', companyName: 'Globex', title: 'Go Engineer (100% remote)' })],
  });
  await runIngest({ db, companies: [ACME, GLOBEX], fetchBoard, now: DAY_1, log: silent });

  const titles = (filter: Partial<JobFilter>): readonly string[] =>
    listJobs(db, { ...ANY, ...filter }).jobs.map((job) => job.title).toSorted();

  assert.deepEqual(titles({ stack: 'java' }), ['Java Developer']);
  assert.deepEqual(titles({ region: 'us' }), ['Go Engineer (100% remote)', 'Senior Backend Engineer', 'Staff Engineer']);
  assert.deepEqual(titles({ liveOnly: true }), ['Go Engineer (100% remote)', 'Java Developer', 'Senior Backend Engineer']);
  assert.deepEqual(titles({ q: 'globex' }), ['Go Engineer (100% remote)']);
  assert.deepEqual(titles({ q: '100%' }), ['Go Engineer (100% remote)']);
  assert.equal(listJobs(db, { ...ANY, limit: 2 }).jobs.length, 2);
  assert.equal(listJobs(db, { ...ANY, limit: 2 }).total, 4);
});

test('getJob returns null for an unknown id', () => {
  assert.equal(getJob(openDatabase(':memory:'), 404), null);
});

test('parseCompanies accepts a valid list', () => {
  assert.deepEqual(parseCompanies([{ source: 'ashby', token: 'ramp', name: 'Ramp' }]), [
    { source: 'ashby', token: 'ramp', name: 'Ramp' },
  ]);
});

test('parseCompanies rejects an unknown source, a bad token and a non-list', () => {
  assert.throws(() => parseCompanies([{ source: 'workday', token: 'x', name: 'X' }]), /entry 1/);
  assert.throws(() => parseCompanies([{ source: 'lever', token: 'a/b', name: 'X' }]), /entry 1/);
  assert.throws(() => parseCompanies({}), /must be a list/);
});
