import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planSync } from '../src/sync.ts';
import { hashContent, normalizeTitle } from '../src/text.ts';
import type { ClassifiedJob, StoredJob } from '../src/types.ts';

const NOW = '2026-11-16T12:00:00.000Z';
const DESCRIPTION = Array.from({ length: 30 }, (_, i) => `Responsibility ${i}: build and run Go services`).join('. ');

const fetched = (overrides: Partial<ClassifiedJob> = {}): ClassifiedJob => {
  const title = overrides.title ?? 'Senior Backend Engineer';
  const description = overrides.description ?? DESCRIPTION;
  return {
    source: 'greenhouse',
    company: 'acme',
    companyName: 'Acme',
    externalId: '100',
    url: 'https://example.com/jobs/100',
    title,
    locations: ['New York, NY'],
    countryHints: [],
    remote: false,
    postedAt: '2026-11-10T00:00:00.000Z',
    description,
    salary: null,
    stacks: ['go'],
    region: 'us',
    location: 'New York, NY',
    titleKey: normalizeTitle(title),
    contentHash: hashContent(title, description),
    ...overrides,
  };
};

const stored = (overrides: Partial<StoredJob> = {}): StoredJob => {
  const title = overrides.title ?? 'Senior Backend Engineer';
  const description = overrides.description ?? DESCRIPTION;
  return {
    id: 1,
    externalId: '100',
    title,
    titleKey: normalizeTitle(title),
    location: 'New York, NY',
    description,
    contentHash: hashContent(title, description),
    salary: null,
    repostOf: null,
    firstSeenAt: '2026-11-10T00:00:00.000Z',
    closedAt: null,
    repostCount: 0,
    originalPostedAt: '2026-11-10T00:00:00.000Z',
    ...overrides,
  };
};

test('a posting seen for the first time is inserted as published', () => {
  const plan = planSync([], [fetched()], new Set(['100']), NOW);

  assert.equal(plan.inserts.length, 1);
  assert.equal(plan.inserts[0]?.repostOf, null);
  assert.equal(plan.inserts[0]?.repostCount, 0);
  assert.equal(plan.inserts[0]?.originalPostedAt, '2026-11-10T00:00:00.000Z');
});

test('a posting without a publication date starts its history at first sight', () => {
  const plan = planSync([], [fetched({ postedAt: null })], new Set(['100']), NOW);

  assert.equal(plan.inserts[0]?.originalPostedAt, NOW);
});

test('an unchanged posting is only touched', () => {
  const plan = planSync([stored()], [fetched()], new Set(['100']), NOW);

  assert.equal(plan.inserts.length, 0);
  assert.equal(plan.closes.length, 0);
  assert.deepEqual(plan.updates, [{ id: 1, job: fetched(), changes: [] }]);
});

test('edited text, title and salary are reported as separate changes', () => {
  const next = fetched({ title: 'Staff Backend Engineer', description: `${DESCRIPTION}. New paragraph.`, salary: '$200K - $250K' });

  const plan = planSync([stored()], [next], new Set(['100']), NOW);

  assert.deepEqual(plan.updates[0]?.changes, ['title_changed', 'text_changed', 'salary_changed']);
});

test('a posting missing from the board is closed', () => {
  const plan = planSync([stored()], [], new Set<string>(), NOW);

  assert.deepEqual(plan.closes, [1]);
});

test('a posting still on the board but edited out of the Go/Java filter is closed, not left stale', () => {
  const plan = planSync([stored()], [], new Set(['100']), NOW);

  assert.deepEqual(plan.closes, [1]);
});

test('a posting that is still on the board is never the origin of a repost', () => {
  const plan = planSync([stored()], [fetched({ externalId: '200' })], new Set(['100', '200']), NOW);

  assert.equal(plan.inserts[0]?.repostOf, null);
});

test('the same opening in another city is not a repost', () => {
  const old = stored({ id: 7, closedAt: '2026-10-01T00:00:00.000Z' });

  const plan = planSync([old], [fetched({ externalId: '200', location: 'Austin, TX' })], new Set(['200']), NOW);

  assert.equal(plan.inserts[0]?.repostOf, null);
});

test('a closed posting that already has a successor is not reposted a second time', () => {
  const origin = stored({ id: 1, externalId: '100', closedAt: '2026-10-01T00:00:00.000Z' });
  const successor = stored({ id: 2, externalId: '150', repostOf: 1, repostCount: 1 });

  const plan = planSync([origin, successor], [fetched({ externalId: '150' }), fetched({ externalId: '200' })], new Set(['150', '200']), NOW);

  assert.equal(plan.inserts[0]?.repostOf, null);
});

test('a closed posting that comes back under the same id is reopened', () => {
  const plan = planSync([stored({ closedAt: '2026-11-12T00:00:00.000Z' })], [fetched()], new Set(['100']), NOW);

  assert.deepEqual(plan.updates[0]?.changes, ['reopened']);
});

test('the same posting under a new id is linked as a repost and keeps the original date', () => {
  const old = stored({ id: 7, externalId: '100', originalPostedAt: '2026-03-01T00:00:00.000Z', repostCount: 2 });

  const plan = planSync([old], [fetched({ externalId: '200' })], new Set(['200']), NOW);

  assert.deepEqual(plan.closes, [7]);
  assert.equal(plan.inserts[0]?.repostOf, 7);
  assert.equal(plan.inserts[0]?.repostCount, 3);
  assert.equal(plan.inserts[0]?.originalPostedAt, '2026-03-01T00:00:00.000Z');
});

test('a new posting with the same title but different text is not a repost', () => {
  const old = stored({ id: 7, closedAt: '2026-10-01T00:00:00.000Z' });
  const different = fetched({ externalId: '200', description: 'A completely different team working on Java batch pipelines for data.' });

  const plan = planSync([old], [different], new Set(['200']), NOW);

  assert.equal(plan.inserts[0]?.repostOf, null);
});

test('a second opening next to a still-open twin is not a repost', () => {
  const plan = planSync([stored()], [fetched(), fetched({ externalId: '200' })], new Set(['100', '200']), NOW);

  assert.equal(plan.inserts.length, 1);
  assert.equal(plan.inserts[0]?.repostOf, null);
});

test('one closed posting is claimed by at most one repost', () => {
  const old = stored({ id: 7, closedAt: '2026-10-01T00:00:00.000Z' });

  const plan = planSync([old], [fetched({ externalId: '200' }), fetched({ externalId: '300' })], new Set(['200', '300']), NOW);

  assert.deepEqual(plan.inserts.map((insert) => insert.repostOf), [7, null]);
});

test('a repost continues from the latest link of the chain', () => {
  const first = stored({ id: 1, externalId: '100', closedAt: '2026-06-01T00:00:00.000Z', originalPostedAt: '2026-03-01T00:00:00.000Z' });
  const second = stored({
    id: 2,
    externalId: '150',
    closedAt: '2026-09-01T00:00:00.000Z',
    repostOf: 1,
    repostCount: 1,
    originalPostedAt: '2026-03-01T00:00:00.000Z',
  });

  const plan = planSync([first, second], [fetched({ externalId: '200' })], new Set(['200']), NOW);

  assert.equal(plan.inserts[0]?.repostOf, 2);
  assert.equal(plan.inserts[0]?.repostCount, 2);
});
