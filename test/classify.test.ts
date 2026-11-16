import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classify, detectRegion, detectStacks, isEngineeringTitle } from '../src/classify.ts';
import type { RawJob } from '../src/types.ts';

const rawJob = (overrides: Partial<RawJob> = {}): RawJob => ({
  source: 'greenhouse',
  company: 'acme',
  companyName: 'Acme',
  externalId: '1',
  url: 'https://example.com/jobs/1',
  title: 'Senior Backend Engineer',
  locations: ['New York, NY'],
  countryHints: [],
  remote: false,
  postedAt: '2026-11-01T00:00:00.000Z',
  description: 'You will write services in Go and Python.',
  salary: null,
  ...overrides,
});

test('detectStacks finds Java but not JavaScript', () => {
  assert.deepEqual(detectStacks('Backend Engineer', 'Strong Java and Spring experience.'), ['java']);
  assert.deepEqual(detectStacks('Frontend Engineer', 'Strong JavaScript and TypeScript experience.'), []);
});

test('detectStacks finds Go written as Golang or in a language list', () => {
  assert.deepEqual(detectStacks('Golang Developer', ''), ['go']);
  assert.deepEqual(detectStacks('Backend Engineer', 'Experience with Python, Go, or Rust.'), ['go']);
  assert.deepEqual(detectStacks('Backend Engineer', 'Our services are written in Go.'), ['go']);
  assert.deepEqual(detectStacks('Software Engineer (Go)', ''), ['go']);
});

test('detectStacks finds Go as a bare list entry or before a skill word', () => {
  assert.deepEqual(detectStacks('Backend Engineer', 'Stack: Kubernetes, Go, Postgres'), ['go']);
  assert.deepEqual(detectStacks('Backend Engineer', 'Strong Go skills required.'), ['go']);
});

test('detectStacks does not read ordinary English "go" as the language', () => {
  assert.deepEqual(detectStacks('Software Engineer', 'You will own our Go-to-market tooling and go the extra mile.'), []);
  assert.deepEqual(detectStacks('Software Engineer', 'Go above and beyond. Ready to go?'), []);
});

test('detectStacks returns both stacks when both are named', () => {
  assert.deepEqual(detectStacks('Backend Engineer', 'We use Java and Go in production.'), ['go', 'java']);
});

test('isEngineeringTitle accepts engineering roles and rejects the rest', () => {
  assert.equal(isEngineeringTitle('Staff Software Engineer, Payments'), true);
  assert.equal(isEngineeringTitle('Java Developer'), true);
  assert.equal(isEngineeringTitle('Site Reliability Engineer'), true);
  assert.equal(isEngineeringTitle('Account Executive'), false);
  assert.equal(isEngineeringTitle('Technical Recruiter, Engineering'), false);
  assert.equal(isEngineeringTitle('Sales Engineer'), false);
});

test('detectRegion recognises US locations by country, state and hub city', () => {
  assert.equal(detectRegion(['San Francisco, CA'], []), 'us');
  assert.equal(detectRegion(['Remote - US'], []), 'us');
  assert.equal(detectRegion(['Seattle'], []), 'us');
  assert.equal(detectRegion(['Anywhere'], ['United States']), 'us');
  assert.equal(detectRegion(['Toronto'], ['Canada', 'USA']), 'us');
});

test('detectRegion does not read foreign country codes as US states', () => {
  for (const place of ['Berlin, DE', 'Tel Aviv, IL', 'Bengaluru, IN', 'Medellin, CO', 'Toronto, CA', 'Bucharest, Romania, ME']) {
    assert.equal(detectRegion([place], []), 'other', place);
  }
  assert.equal(detectRegion(['Denver, CO'], []), 'us');
  assert.equal(detectRegion(['Indianapolis, IN, United States'], []), 'us');
});

test('detectRegion marks non-US locations as other', () => {
  assert.equal(detectRegion(['Dublin'], []), 'other');
  assert.equal(detectRegion(['Bengaluru, India'], []), 'other');
  assert.equal(detectRegion(['Remote'], ['DE']), 'other');
});

test('detectRegion is unknown when the location says nothing about a country', () => {
  assert.equal(detectRegion(['Remote'], []), 'unknown');
  assert.equal(detectRegion([], []), 'unknown');
});

test('classify keeps a Go engineering job and derives its fields', () => {
  const job = classify(rawJob());

  assert.ok(job);
  assert.deepEqual(job.stacks, ['go']);
  assert.equal(job.region, 'us');
  assert.equal(job.location, 'New York, NY');
  assert.equal(job.titleKey, 'senior backend engineer');
  assert.match(job.contentHash, /^[0-9a-f]{64}$/);
});

test('classify drops jobs outside Go and Java', () => {
  assert.equal(classify(rawJob({ description: 'Ruby on Rails monolith.' })), null);
});

test('classify drops non-engineering jobs that only mention the stack', () => {
  assert.equal(classify(rawJob({ title: 'Account Executive', description: 'Sell to Java teams.' })), null);
});

test('classify fills salary from the description when the board gave none', () => {
  const job = classify(rawJob({ description: 'Go services. Range: $170,000 - $220,000.' }));

  assert.equal(job?.salary, '$170,000 - $220,000');
});
