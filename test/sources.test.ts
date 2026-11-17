import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseAshby } from '../src/sources/ashby.ts';
import { parseGreenhouse } from '../src/sources/greenhouse.ts';
import { createBoardFetcher } from '../src/sources/index.ts';
import { parseLever } from '../src/sources/lever.ts';
import type { Company } from '../src/types.ts';

const company = (source: Company['source']): Company => ({ source, token: 'acme', name: 'Acme' });

test('parseGreenhouse maps a posting and turns escaped HTML into text', () => {
  const payload = {
    jobs: [
      {
        id: 8172487,
        title: 'Backend Engineer',
        absolute_url: 'https://acme.com/jobs?gh_jid=8172487',
        location: { name: 'New York, NY' },
        offices: [{ name: 'US Offices', location: 'New York, NY, United States' }],
        company_name: 'Acme Inc',
        first_published: '2026-09-03T13:30:34-04:00',
        updated_at: '2026-10-29T10:42:09-04:00',
        content: '&lt;p&gt;We write Go.&lt;/p&gt;&lt;p&gt;$150,000 - $200,000&lt;/p&gt;',
      },
    ],
  };

  const jobs = parseGreenhouse(company('greenhouse'), payload);

  assert.deepEqual(jobs, [
    {
      source: 'greenhouse',
      company: 'acme',
      companyName: 'Acme Inc',
      externalId: '8172487',
      url: 'https://acme.com/jobs?gh_jid=8172487',
      title: 'Backend Engineer',
      locations: ['New York, NY', 'New York, NY, United States'],
      countryHints: [],
      remote: false,
      postedAt: '2026-09-03T17:30:34.000Z',
      description: 'We write Go.\n$150,000 - $200,000',
      salary: null,
    },
  ]);
});

test('parseLever joins the description parts and reads the country', () => {
  const payload = [
    {
      id: '2a55d6c9',
      text: 'Java Developer',
      hostedUrl: 'https://jobs.lever.co/acme/2a55d6c9',
      categories: { location: 'Austin, TX', allLocations: ['Austin, TX', 'Remote'] },
      country: 'US',
      workplaceType: 'remote',
      createdAt: 1792767640768,
      descriptionPlain: 'Build services.',
      lists: [{ text: 'Requirements', content: '<li>Java</li><li>Spring</li>' }],
      additionalPlain: 'Benefits included.',
      salaryRange: { min: 150000, max: 190000, currency: 'USD', interval: 'per-year-salary' },
    },
  ];

  const [job] = parseLever(company('lever'), payload);

  assert.equal(job?.externalId, '2a55d6c9');
  assert.equal(job?.title, 'Java Developer');
  assert.deepEqual(job?.locations, ['Austin, TX', 'Remote']);
  assert.deepEqual(job?.countryHints, ['US']);
  assert.equal(job?.remote, true);
  assert.equal(job?.postedAt, new Date(1792767640768).toISOString());
  assert.equal(job?.description, 'Build services.\nRequirements\nJava\nSpring\nBenefits included.');
  assert.equal(job?.salary, '$150,000 - $190,000');
});

test('parseAshby maps a posting, its extra locations and its pay range', () => {
  const payload = {
    jobs: [
      {
        id: '34413f8d',
        title: 'Software Engineer, Backend',
        location: 'New York, NY (HQ)',
        secondaryLocations: [
          { location: 'Remote (Canada)', address: { postalAddress: { addressCountry: 'Canada' } } },
        ],
        address: { postalAddress: { addressCountry: 'USA' } },
        publishedAt: '2026-04-07T17:12:35.753+00:00',
        isListed: true,
        isRemote: true,
        jobUrl: 'https://jobs.ashbyhq.com/acme/34413f8d',
        descriptionPlain: 'We use Go and Postgres.',
        compensation: { scrapeableCompensationSalarySummary: '$211.4K - $290.6K' },
      },
      { id: 'hidden', title: 'Unlisted role', jobUrl: 'https://jobs.ashbyhq.com/acme/hidden', isListed: false },
    ],
  };

  const jobs = parseAshby(company('ashby'), payload);

  assert.equal(jobs.length, 1);
  assert.deepEqual(jobs[0]?.locations, ['New York, NY (HQ)', 'Remote (Canada)']);
  assert.deepEqual(jobs[0]?.countryHints, ['USA', 'Canada']);
  assert.equal(jobs[0]?.postedAt, '2026-04-07T17:12:35.753Z');
  assert.equal(jobs[0]?.salary, '$211.4K - $290.6K');
  assert.equal(jobs[0]?.companyName, 'Acme');
});

test('a posting that cannot be read fails the whole board instead of being dropped', () => {
  const valid = { id: 1, title: 'Engineer', absolute_url: 'https://x.test/1' };

  assert.throws(() => parseGreenhouse(company('greenhouse'), { jobs: [valid, { id: 2, title: 'No link' }] }), /Malformed postings/);
  assert.throws(() => parseLever(company('lever'), ['garbage']), /Malformed postings/);
  assert.throws(() => parseAshby(company('ashby'), { jobs: [{ id: 'x', name: 'renamed field' }] }), /Malformed postings/);
});

test('a few unreadable postings are skipped while the rest of the board is kept', () => {
  const valid = (id: number) => ({ id, title: 'Engineer', absolute_url: `https://x.test/${id}` });

  const jobs = parseGreenhouse(company('greenhouse'), { jobs: [valid(1), valid(2), valid(3), { id: 4, title: 'No link' }] });

  assert.deepEqual(jobs.map((job) => job.externalId), ['1', '2', '3']);
});

test('parsers reject a payload of the wrong shape instead of reporting an empty board', () => {
  assert.throws(() => parseGreenhouse(company('greenhouse'), { error: 'not found' }), /Unexpected Greenhouse response/);
  assert.throws(() => parseLever(company('lever'), { ok: false }), /Unexpected Lever response/);
  assert.throws(() => parseAshby(company('ashby'), []), /Unexpected Ashby response/);
});

test('an unparseable date becomes null rather than an invalid date', () => {
  const payload = { jobs: [{ id: 1, title: 'Engineer', absolute_url: 'https://x.test/1', first_published: 'soon' }] };

  assert.equal(parseGreenhouse(company('greenhouse'), payload)[0]?.postedAt, null);
});

test('createBoardFetcher requests the board for the company source', async () => {
  const requested: string[] = [];
  const fetchBoard = createBoardFetcher(async (url) => {
    requested.push(url);
    return { jobs: [] };
  });

  await fetchBoard(company('greenhouse'));
  await fetchBoard(company('ashby'));

  assert.deepEqual(requested, [
    'https://boards-api.greenhouse.io/v1/boards/acme/jobs?content=true',
    'https://api.ashbyhq.com/posting-api/job-board/acme?includeCompensation=true',
  ]);
});

test('createBoardFetcher refuses a board token that is not a plain slug', async () => {
  const fetchBoard = createBoardFetcher(async () => ({ jobs: [] }));

  await assert.rejects(fetchBoard({ source: 'lever', token: '../admin?x=1', name: 'Bad' }), /Invalid board token/);
});
