import { test } from 'node:test';
import assert from 'node:assert/strict';
import { discoverBoards, mergeCompanies, parseNameList, slugCandidates } from '../src/discover.ts';
import type { FetchBoard } from '../src/sources/index.ts';
import type { Company, RawJob } from '../src/types.ts';

const job = (company: Company, id: string): RawJob => ({
  source: company.source,
  company: company.token,
  companyName: company.name,
  externalId: id,
  url: `https://x.test/${id}`,
  title: 'Engineer',
  locations: [],
  countryHints: [],
  remote: false,
  postedAt: null,
  description: '',
  salary: null,
});

test('slugCandidates gives the joined and the dashed slug', () => {
  assert.deepEqual(slugCandidates('Grafana Labs'), ['grafanalabs', 'grafana-labs']);
  assert.deepEqual(slugCandidates('Notion'), ['notion']);
  assert.deepEqual(slugCandidates('Crème & Co.'), ['cremeco', 'creme-co']);
});

test('parseNameList ignores blank lines, comments and duplicates', () => {
  assert.deepEqual(parseNameList('# list\nAcme\n\n  Globex  \nacme\n'), ['Acme', 'Globex']);
});

test('discoverBoards keeps the board with the most postings and skips missing ones', async () => {
  const boards: Readonly<Record<string, number>> = { 'greenhouse/acme': 3, 'ashby/acme': 9, 'lever/globex': 0 };
  const fetchBoard: FetchBoard = async (company) => {
    const count = boards[`${company.source}/${company.token}`];
    if (count === undefined) throw new Error('HTTP 404');
    return Array.from({ length: count }, (_, i) => job(company, String(i)));
  };

  const found = await discoverBoards({ names: ['Acme', 'Globex'], fetchBoard, log: () => {} });

  assert.deepEqual(found, [{ source: 'ashby', token: 'acme', name: 'Acme' }]);
});

test('mergeCompanies appends new boards and skips known boards and names', () => {
  const existing: readonly Company[] = [{ source: 'lever', token: 'acme', name: 'Acme' }];
  const found: readonly Company[] = [
    { source: 'greenhouse', token: 'acme2', name: 'ACME' },
    { source: 'lever', token: 'acme', name: 'Acme Inc' },
    { source: 'ashby', token: 'globex', name: 'Globex' },
  ];

  assert.deepEqual(mergeCompanies(existing, found), [...existing, { source: 'ashby', token: 'globex', name: 'Globex' }]);
});
