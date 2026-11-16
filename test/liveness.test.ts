import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assessLiveness } from '../src/liveness.ts';
import type { LivenessFacts } from '../src/liveness.ts';

const NOW = '2026-11-16T12:00:00.000Z';
const daysAgo = (days: number): string => new Date(Date.parse(NOW) - days * 86_400_000).toISOString();

const facts = (overrides: Partial<LivenessFacts> = {}): LivenessFacts => ({
  now: NOW,
  title: 'Senior Backend Engineer',
  postedAtKnown: true,
  originalPostedAt: daysAgo(5),
  firstSeenAt: daysAgo(5),
  closedAt: null,
  repostCount: 0,
  textChangeCount: 0,
  lastTextChangeAt: null,
  agePercentile: null,
  ...overrides,
});

test('a fresh posting is rated as hiring', () => {
  const result = assessLiveness(facts());

  assert.equal(result.verdict, 'hiring');
  assert.equal(result.score, 100);
  assert.ok(result.signals.some((s) => s.kind === 'good' && /5 days ago/.test(s.text)));
});

test('a posting open for months with several reposts is rated unlikely', () => {
  const result = assessLiveness(facts({ originalPostedAt: daysAgo(240), firstSeenAt: daysAgo(240), repostCount: 6, agePercentile: 0.95 }));

  assert.equal(result.verdict, 'unlikely');
  assert.ok(result.signals.some((s) => /Reposted 6 times/.test(s.text)));
  assert.ok(result.signals.some((s) => /longer than 95%/.test(s.text)));
  assert.ok(result.signals.some((s) => /has not changed in the 240 days/.test(s.text)));
});

test('a two-month-old posting with no other signals is unclear', () => {
  const result = assessLiveness(facts({ originalPostedAt: daysAgo(70) }));

  assert.equal(result.verdict, 'unclear');
});

test('an old posting we only just started tracking is not blamed for an unchanged description', () => {
  const result = assessLiveness(facts({ originalPostedAt: daysAgo(400), firstSeenAt: daysAgo(1) }));

  assert.equal(result.verdict, 'unlikely');
  assert.ok(!result.signals.some((s) => /not changed/.test(s.text)));
});

test('a recent description edit counts in favour of an old posting', () => {
  const stale = assessLiveness(facts({ originalPostedAt: daysAgo(70) }));
  const edited = assessLiveness(
    facts({ originalPostedAt: daysAgo(70), textChangeCount: 1, lastTextChangeAt: daysAgo(3) }),
  );

  assert.ok((edited.score ?? 0) > (stale.score ?? 0));
  assert.ok(edited.signals.some((s) => s.kind === 'good' && /updated 3 days ago/.test(s.text)));
});

test('a talent-pool posting is penalised whatever its age', () => {
  const result = assessLiveness(facts({ title: 'Future Opportunities: Backend Engineers (Talent Pool)' }));

  assert.notEqual(result.verdict, 'hiring');
  assert.ok(result.signals.some((s) => /talent pool/i.test(s.text)));
});

test('without a publication date and with little history there is no verdict', () => {
  const result = assessLiveness(facts({ postedAtKnown: false, originalPostedAt: daysAgo(2), firstSeenAt: daysAgo(2) }));

  assert.equal(result.verdict, 'insufficient');
  assert.equal(result.score, null);
});

test('without a publication date but with enough history a verdict is given', () => {
  const result = assessLiveness(facts({ postedAtKnown: false, originalPostedAt: daysAgo(40), firstSeenAt: daysAgo(40) }));

  assert.equal(result.verdict, 'hiring');
});

test('a closed posting is reported as closed', () => {
  const result = assessLiveness(facts({ closedAt: daysAgo(1) }));

  assert.equal(result.verdict, 'closed');
  assert.equal(result.score, null);
});

test('the score never drops below zero', () => {
  const result = assessLiveness(
    facts({
      title: 'Evergreen: General Application',
      originalPostedAt: daysAgo(400),
      repostCount: 9,
      agePercentile: 0.99,
    }),
  );

  assert.equal(result.score, 0);
});
