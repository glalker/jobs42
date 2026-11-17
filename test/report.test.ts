import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runIngest } from '../src/ingest.ts';
import { buildLeadReport, toCsv } from '../src/report.ts';
import type { LeadRow } from '../src/report.ts';
import { openDatabase } from '../src/store/schema.ts';
import type { Company, RawJob } from '../src/types.ts';

const NOW = '2026-11-17T12:00:00.000Z';
const ACME: Company = { source: 'greenhouse', token: 'acme', name: 'Acme' };
const TINY: Company = { source: 'ashby', token: 'tiny', name: 'Tiny' };
const daysAgo = (days: number): string => new Date(Date.parse(NOW) - days * 86_400_000).toISOString();

const posting = (company: Company, id: string, overrides: Partial<RawJob> = {}): RawJob => ({
  source: company.source,
  company: company.token,
  companyName: company.name,
  externalId: id,
  url: `https://example.test/${company.token}/${id}`,
  title: `Backend Engineer ${id}`,
  locations: ['New York, NY'],
  countryHints: [],
  remote: false,
  postedAt: daysAgo(5),
  description: `Build services in Go. Team ${id}.`,
  salary: null,
  ...overrides,
});

async function seed(): Promise<ReturnType<typeof openDatabase>> {
  const db = openDatabase(':memory:');
  const boards: Readonly<Record<string, readonly RawJob[]>> = {
    acme: [
      posting(ACME, '1', { postedAt: daysAgo(2) }),
      posting(ACME, '2', { postedAt: daysAgo(10), description: 'Java and Spring services.' }),
      posting(ACME, '3', { postedAt: daysAgo(20) }),
      posting(ACME, '4', { postedAt: daysAgo(120), title: '=HYPERLINK("http://evil.test") Engineer' }),
      posting(ACME, '5', { postedAt: daysAgo(500) }),
      posting(ACME, '6', { locations: ['Berlin'] }),
      posting(ACME, '7', { title: 'Account Executive', description: 'Sales.' }),
    ],
    tiny: [posting(TINY, 'a'), posting(TINY, 'b')],
  };
  await runIngest({
    db,
    companies: [ACME, TINY],
    fetchBoard: async (company) => boards[company.token] ?? [],
    now: NOW,
    log: () => {},
  });
  return db;
}

test('buildLeadReport summarises US Go/Java hiring per company and skips small hirers', async () => {
  const db = await seed();

  const rows = buildLeadReport(db, [ACME, TINY], NOW);

  assert.equal(rows.length, 1);
  const acme = rows[0] as LeadRow;
  assert.equal(acme.company, 'Acme');
  assert.equal(acme.goJavaOpen, 5);
  assert.equal(acme.goOpen, 4);
  assert.equal(acme.javaOpen, 1);
  assert.equal(acme.new30d, 3);
  assert.equal(acme.open90to365d, 1);
  assert.equal(acme.open365dPlus, 1);
  assert.equal(acme.reposted, 0);
  assert.equal(acme.medianDaysOpen, 20);
  assert.equal(acme.boardPostings, 7);
  assert.equal(acme.goJavaShare, 0.71);
  assert.equal(acme.segment, 'small');
  assert.equal(acme.score, 3 * 2 + 1);
  assert.equal(acme.careersUrl, 'https://boards.greenhouse.io/acme');
  assert.equal(acme.sampleTitles.length, 3);
});

test('buildLeadReport ranks companies by score', async () => {
  const db = await seed();
  const many: Company = { source: 'lever', token: 'many', name: 'Many' };
  const fresh = Array.from({ length: 6 }, (_, i) => posting(many, `m${i}`, { postedAt: daysAgo(3) }));
  await runIngest({ db, companies: [many], fetchBoard: async () => fresh, now: NOW, log: () => {} });

  const rows = buildLeadReport(db, [ACME, TINY, many], NOW);

  assert.deepEqual(rows.map((row) => row.company), ['Many', 'Acme']);
});

test('toCsv quotes fields and neutralises spreadsheet formulas from posting titles', async () => {
  const db = await seed();

  const csv = toCsv(buildLeadReport(db, [ACME], NOW));

  const [header, line] = csv.trimEnd().split('\n');
  assert.equal(header, 'company,segment,score,go_java_open,go_open,java_open,new_30d,open_90_365d,open_365d_plus,reposted,median_days_open,board_postings,go_java_share,careers_url,sample_titles');
  assert.match(line ?? '', /^Acme,small,7,5,4,1,3,1,1,0,20,7,0\.71,https:\/\/boards\.greenhouse\.io\/acme,/);
});

test('toCsv prefixes a cell that would start a spreadsheet formula', () => {
  const row: LeadRow = {
    company: '=HYPERLINK("http://evil.test")',
    segment: 'small',
    score: 1,
    goJavaOpen: 3,
    goOpen: 3,
    javaOpen: 0,
    new30d: 0,
    open90to365d: 1,
    open365dPlus: 0,
    reposted: 0,
    medianDaysOpen: 100,
    boardPostings: 10,
    goJavaShare: 0.3,
    careersUrl: 'https://jobs.lever.co/x',
    sampleTitles: ['Go Engineer, Payments'],
  };

  const line = toCsv([row]).trimEnd().split('\n')[1] ?? '';

  assert.match(line, /^"'=HYPERLINK\(""http:\/\/evil\.test""\)",/);
  assert.match(line, /,"Go Engineer, Payments"$/);
});
