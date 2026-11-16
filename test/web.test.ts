import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { runIngest } from '../src/ingest.ts';
import { openDatabase } from '../src/store/schema.ts';
import { createApp } from '../src/web/server.ts';
import { buildPrepUrl, safeHref } from '../src/web/views.ts';
import type { RawJob } from '../src/types.ts';

const NOW = '2026-11-16T12:00:00.000Z';

const posting = (overrides: Partial<RawJob>): RawJob => ({
  source: 'greenhouse',
  company: 'acme',
  companyName: 'Acme & Sons',
  externalId: '1',
  url: 'https://acme.test/jobs/1?ref=a&b=c',
  title: 'Senior Go Engineer',
  locations: ['New York, NY'],
  countryHints: [],
  remote: false,
  postedAt: '2026-11-10T00:00:00.000Z',
  description: 'Build services in Go.\nSecond line <b>not bold</b>.',
  salary: '$180K - $220K',
  ...overrides,
});

let server: Server;
let base: string;

before(async () => {
  const db = openDatabase(':memory:');
  const board: readonly RawJob[] = [
    posting({}),
    posting({ externalId: '2', title: 'Java Developer <script>alert(1)</script>', description: 'Java and Spring.' }),
    posting({ externalId: '3', title: 'Go Engineer, Berlin', locations: ['Berlin'], url: 'javascript:alert(1)' }),
  ];
  await runIngest({
    db,
    companies: [{ source: 'greenhouse', token: 'acme', name: 'Acme' }],
    fetchBoard: async () => board,
    now: NOW,
    log: () => {},
  });
  server = createApp({ db, prepUrlTemplate: 'https://wow42.test/prep?job={jobUrl}', now: () => NOW, log: () => {} });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

after(() => {
  server.close();
});

const get = async (path: string): Promise<{ status: number; body: string; headers: Headers }> => {
  const response = await fetch(`${base}${path}`);
  return { status: response.status, body: await response.text(), headers: response.headers };
};

test('the feed lists US postings with their rating and escapes posting text', async () => {
  const { status, body } = await get('/');

  assert.equal(status, 200);
  assert.match(body, /Senior Go Engineer/);
  assert.match(body, /Acme &amp; Sons/);
  assert.match(body, /Actively hiring/);
  assert.match(body, /Java Developer &lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.doesNotMatch(body, /<script>alert/);
  assert.doesNotMatch(body, /Go Engineer, Berlin/);
});

test('the feed filters by stack, search text and region', async () => {
  const java = await get('/?stack=java');
  const search = await get('/?q=senior');
  const everywhere = await get('/?region=all');

  assert.match(java.body, /Java Developer/);
  assert.doesNotMatch(java.body, /Senior Go Engineer/);
  assert.match(search.body, /Senior Go Engineer/);
  assert.doesNotMatch(search.body, /Java Developer/);
  assert.match(everywhere.body, /Go Engineer, Berlin/);
});

test('the posting page shows the reasons, the history and a prep link carrying the posting URL', async () => {
  const { status, body } = await get('/jobs/1');

  assert.equal(status, 200);
  assert.match(body, /Posted 6 days ago/);
  assert.match(body, /First seen on the company board/);
  assert.match(body, /\$180K - \$220K/);
  assert.match(body, /Second line &lt;b&gt;not bold&lt;\/b&gt;/);
  assert.match(body, /href="https:\/\/wow42\.test\/prep\?job=https%3A%2F%2Facme\.test%2Fjobs%2F1%3Fref%3Da%26b%3Dc"/);
  assert.match(body, /href="https:\/\/acme\.test\/jobs\/1\?ref=a&amp;b=c"/);
});

test('a posting link that is not http is never rendered as a link target', async () => {
  const { body } = await get('/jobs/3');

  assert.doesNotMatch(body, /javascript:/);
});

test('unknown pages and postings return 404', async () => {
  assert.equal((await get('/jobs/999')).status, 404);
  assert.equal((await get('/jobs/abc')).status, 404);
  assert.equal((await get('/nope')).status, 404);
});

test('invalid filter values are rejected with 400', async () => {
  assert.equal((await get('/?stack=ruby')).status, 400);
  assert.equal((await get('/?page=0')).status, 400);
  assert.equal((await get('/api/jobs?region=mars')).status, 400);
});

test('an address that cannot be parsed is a 400, not a server error', async () => {
  const { request } = await import('node:http');
  const status = await new Promise<number>((resolve, reject) => {
    request(`${base}`, { path: '//[' }, (response) => resolve(response.statusCode ?? 0)).on('error', reject).end();
  });

  assert.equal(status, 400);
});

test('only GET and HEAD are allowed', async () => {
  const response = await fetch(`${base}/`, { method: 'POST' });

  assert.equal(response.status, 405);
});

test('the JSON feed uses the response envelope with paging metadata', async () => {
  const { status, body, headers } = await get('/api/jobs?stack=go');
  const payload = JSON.parse(body) as { success: boolean; data: { title: string }[]; error: null; meta: object };

  assert.equal(status, 200);
  assert.match(headers.get('content-type') ?? '', /application\/json/);
  assert.equal(payload.success, true);
  assert.equal(payload.error, null);
  assert.deepEqual(payload.data.map((job) => job.title), ['Senior Go Engineer']);
  assert.deepEqual(payload.meta, { total: 1, page: 1, limit: 30 });
});

test('the JSON posting includes its history, and an unknown one is a 404 envelope', async () => {
  const found = JSON.parse((await get('/api/jobs/1')).body) as { data: { events: { kind: string }[] } };
  const missing = await get('/api/jobs/999');

  assert.deepEqual(found.data.events.map((event) => event.kind), ['published']);
  assert.equal(missing.status, 404);
  assert.deepEqual(JSON.parse(missing.body), { success: false, data: null, error: 'Posting not found' });
});

test('responses carry a restrictive content security policy', async () => {
  const { headers } = await get('/');

  assert.match(headers.get('content-security-policy') ?? '', /default-src 'none'/);
  assert.equal(headers.get('x-content-type-options'), 'nosniff');
});

test('buildPrepUrl encodes the posting URL into the template', () => {
  assert.equal(buildPrepUrl('https://wow42.tech/?job={jobUrl}', 'https://a.test/j?x=1&y=2'), 'https://wow42.tech/?job=https%3A%2F%2Fa.test%2Fj%3Fx%3D1%26y%3D2');
});

test('safeHref passes http links and blanks everything else', () => {
  assert.equal(safeHref('https://a.test/x'), 'https://a.test/x');
  assert.equal(safeHref('javascript:alert(1)'), null);
  assert.equal(safeHref('not a url'), null);
});
