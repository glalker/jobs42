import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { exportStaticSite } from '../src/export.ts';
import { runIngest } from '../src/ingest.ts';
import { openDatabase } from '../src/store/schema.ts';
import type { RawJob } from '../src/types.ts';

const NOW = '2026-11-16T12:00:00.000Z';

const posting = (overrides: Partial<RawJob>): RawJob => ({
  source: 'greenhouse',
  company: 'acme',
  companyName: 'Acme',
  externalId: '1',
  url: 'https://acme.test/jobs/1',
  title: 'Senior Go Engineer',
  locations: ['New York, NY'],
  countryHints: [],
  remote: false,
  postedAt: '2026-11-10T00:00:00.000Z',
  description: 'Build services in Go.',
  salary: null,
  ...overrides,
});

test('exportStaticSite writes a self-contained feed page and one file per US posting', async () => {
  const db = openDatabase(':memory:');
  const board: readonly RawJob[] = [
    posting({}),
    posting({ externalId: '2', title: 'Go Engineer </script><script>alert(1)</script>', url: 'javascript:alert(1)' }),
    posting({ externalId: '3', title: 'Go Engineer, Berlin', locations: ['Berlin'] }),
  ];
  await runIngest({
    db,
    companies: [{ source: 'greenhouse', token: 'acme', name: 'Acme' }],
    fetchBoard: async () => board,
    now: NOW,
    log: () => {},
  });
  const outDir = mkdtempSync(join(tmpdir(), 'jobs42-export-'));

  const result = exportStaticSite({ db, outDir, now: NOW, prepUrlTemplate: 'https://wow42.test/prep?job={jobUrl}' });

  const page = readFileSync(join(outDir, 'index.html'), 'utf8');
  const first = JSON.parse(readFileSync(join(outDir, 'jobs', '1.json'), 'utf8')) as Record<string, unknown>;
  const second = JSON.parse(readFileSync(join(outDir, 'jobs', '2.json'), 'utf8')) as Record<string, unknown>;
  assert.deepEqual(result, { jobs: 2 });
  assert.match(page, /Senior Go Engineer/);
  assert.match(page, /2026-11-16/);
  assert.doesNotMatch(page, /<\/script><script>alert/);
  assert.doesNotMatch(page, /Go Engineer, Berlin/);
  assert.equal(first.description, 'Build services in Go.');
  assert.equal(first.url, 'https://acme.test/jobs/1');
  assert.equal(first.prepUrl, 'https://wow42.test/prep?job=https%3A%2F%2Facme.test%2Fjobs%2F1');
  assert.deepEqual((first.events as { kind: string }[]).map((event) => event.kind), ['published']);
  assert.equal(second.url, null);
  assert.equal(second.prepUrl, null);
  assert.equal(existsSync(join(outDir, 'jobs', '3.json')), false);
  assert.equal(existsSync(join(outDir, '.nojekyll')), true);
});
