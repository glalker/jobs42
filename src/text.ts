import { createHash } from 'node:crypto';

const NAMED_ENTITIES: Readonly<Record<string, string>> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  ndash: '–',
  mdash: '—',
  lsquo: '‘',
  rsquo: '’',
  ldquo: '“',
  rdquo: '”',
  hellip: '…',
  bull: '•',
};

const MAX_CODE_POINT = 0x10ffff;
const SHINGLE_SIZE = 3;

const BLOCK_TAG = /<\/?(?:p|div|br|li|ul|ol|h[1-6]|tr|table|section|article|header|footer|blockquote|hr)\b[^>]*>/gi;
const HIDDEN_BLOCK = /<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi;
const ANY_TAG = /<[^>]+>/g;
const LOOKS_LIKE_HTML = /<[a-z/!]/i;
const SALARY_AMOUNT = String.raw`\$\s?\d{2,3}(?:,\d{3}|(?:\.\d+)?\s?[kK])`;
const SALARY_RANGE = new RegExp(`${SALARY_AMOUNT}\\s*(?:-|–|—|to)\\s*${SALARY_AMOUNT}`);

function codePointToString(codePoint: number, fallback: string): string {
  const valid = Number.isInteger(codePoint) && codePoint > 0 && codePoint <= MAX_CODE_POINT;
  return valid ? String.fromCodePoint(codePoint) : fallback;
}

export function decodeEntities(input: string): string {
  return input.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, body: string) => {
    if (/^#x/i.test(body)) return codePointToString(Number.parseInt(body.slice(2), 16), match);
    if (body.startsWith('#')) return codePointToString(Number.parseInt(body.slice(1), 10), match);
    return NAMED_ENTITIES[body.toLowerCase()] ?? match;
  });
}

export function collapseWhitespace(input: string): string {
  return input.replace(/\s+/g, ' ').trim();
}

/** Turns posting HTML (plain or entity-escaped, as Greenhouse sends it) into plain text lines. */
export function htmlToText(input: string): string {
  const html = LOOKS_LIKE_HTML.test(input) ? input : decodeEntities(input);
  const withoutTags = html.replace(HIDDEN_BLOCK, '').replace(BLOCK_TAG, '\n').replace(ANY_TAG, '');
  return decodeEntities(withoutTags)
    .split('\n')
    .map(collapseWhitespace)
    .filter((line) => line.length > 0)
    .join('\n');
}

export function normalizeTitle(title: string): string {
  return title.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

export function hashContent(title: string, description: string): string {
  return createHash('sha256').update(`${title.trim()}\n${collapseWhitespace(description)}`).digest('hex');
}

function shingles(text: string): ReadonlySet<string> {
  const words = text.toLowerCase().match(/[a-z0-9]+/g) ?? [];
  if (words.length === 0) return new Set();
  if (words.length < SHINGLE_SIZE) return new Set([words.join(' ')]);
  return new Set(
    words.slice(0, words.length - SHINGLE_SIZE + 1).map((_, i) => words.slice(i, i + SHINGLE_SIZE).join(' ')),
  );
}

/** Jaccard similarity over word shingles: 1 for the same wording, near 0 for unrelated text. */
export function textSimilarity(first: string, second: string): number {
  const a = shingles(first);
  const b = shingles(second);
  if (a.size === 0 || b.size === 0) return 0;
  const shared = [...a].filter((shingle) => b.has(shingle)).length;
  return shared / (a.size + b.size - shared);
}

export function extractSalary(text: string): string | null {
  return SALARY_RANGE.exec(text)?.[0] ?? null;
}
