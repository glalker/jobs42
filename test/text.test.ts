import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  extractSalary,
  hashContent,
  htmlToText,
  normalizeTitle,
  textSimilarity,
} from '../src/text.ts';

test('htmlToText strips tags and keeps block boundaries as newlines', () => {
  const text = htmlToText('<h2>About</h2><p>We build <strong>Go</strong> services.</p><ul><li>Kafka</li><li>gRPC</li></ul>');

  assert.equal(text, 'About\nWe build Go services.\nKafka\ngRPC');
});

test('htmlToText decodes entity-escaped HTML the way Greenhouse sends it', () => {
  const text = htmlToText('&lt;p&gt;Java &amp;amp; Kotlin&lt;/p&gt;&lt;p&gt;It&#39;s remote&lt;/p&gt;');

  assert.equal(text, 'Java & Kotlin\nIt\'s remote');
});

test('htmlToText drops script and style contents', () => {
  const text = htmlToText('<style>p{color:red}</style><p>Hello</p><script>alert(1)</script>');

  assert.equal(text, 'Hello');
});

test('normalizeTitle ignores case, punctuation and spacing', () => {
  assert.equal(normalizeTitle('  Senior Software Engineer, Backend (Go) '), 'senior software engineer backend go');
});

test('hashContent is stable across whitespace-only changes', () => {
  const first = hashContent('Backend Engineer', 'We use Go.\n\nRemote.');
  const second = hashContent('Backend Engineer', 'We use  Go. Remote. ');

  assert.equal(first, second);
});

test('hashContent changes when the wording changes', () => {
  assert.notEqual(hashContent('Backend Engineer', 'We use Go.'), hashContent('Backend Engineer', 'We use Java.'));
});

test('textSimilarity is 1 for identical text and low for unrelated text', () => {
  const posting = 'We are hiring a backend engineer to build payment services in Go with Kafka and Postgres';

  assert.equal(textSimilarity(posting, posting), 1);
  assert.ok(textSimilarity(posting, 'Our sales team is looking for an account executive in London') < 0.1);
});

test('textSimilarity stays high when one sentence is edited', () => {
  const base = Array.from({ length: 40 }, (_, i) => `requirement number ${i} about distributed systems`).join(' ');

  assert.ok(textSimilarity(base, `${base} plus one extra closing sentence`) > 0.8);
});

test('textSimilarity returns 0 when either text is empty', () => {
  assert.equal(textSimilarity('', 'something here to compare'), 0);
});

test('extractSalary finds a dollar range in running text', () => {
  assert.equal(
    extractSalary('The base range for this role is $150,000 - $210,000 plus equity.'),
    '$150,000 - $210,000',
  );
  assert.equal(extractSalary('Pay: $180K–$240K per year'), '$180K–$240K');
});

test('extractSalary returns null when there is no range', () => {
  assert.equal(extractSalary('Competitive salary and a $500 stipend.'), null);
});
