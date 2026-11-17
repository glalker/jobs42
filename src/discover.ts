import { isBoardToken } from './sources/index.ts';
import type { FetchBoard } from './sources/index.ts';
import type { Company, Source } from './types.ts';

export interface DiscoverOptions {
  readonly names: readonly string[];
  readonly fetchBoard: FetchBoard;
  readonly log: (line: string) => void;
  readonly concurrency?: number;
}

const SOURCES: readonly Source[] = ['greenhouse', 'lever', 'ashby'];
const DEFAULT_CONCURRENCY = 6;

export function slugCandidates(name: string): readonly string[] {
  const plain = name.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const joined = plain.replace(/[^a-z0-9]+/g, '');
  const dashed = plain.replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return [...new Set([joined, dashed])].filter(isBoardToken);
}

/** One company name per line; blank lines and lines starting with # are skipped. */
export function parseNameList(text: string): readonly string[] {
  const names = text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith('#'));
  return names.filter(
    (name, index) => names.findIndex((other) => other.toLowerCase() === name.toLowerCase()) === index,
  );
}

async function boardSize(fetchBoard: FetchBoard, company: Company): Promise<number> {
  try {
    return (await fetchBoard(company)).length;
  } catch {
    // Most guesses do not exist (404), and a board we cannot read counts as not found.
    return 0;
  }
}

async function findBoard(fetchBoard: FetchBoard, name: string): Promise<Company | null> {
  const guesses = slugCandidates(name).flatMap((token) => SOURCES.map((source) => ({ source, token, name })));
  const sizes = await Promise.all(guesses.map((guess) => boardSize(fetchBoard, guess)));
  const best = guesses
    .map((company, i) => ({ company, size: sizes[i] ?? 0 }))
    .filter((entry) => entry.size > 0)
    .toSorted((a, b) => b.size - a.size)[0];
  return best?.company ?? null;
}

/** Guesses each company's board slug on Greenhouse, Lever and Ashby and keeps the busiest board found. */
export async function discoverBoards(options: DiscoverOptions): Promise<readonly Company[]> {
  const size = options.concurrency ?? DEFAULT_CONCURRENCY;
  const batches = Array.from({ length: Math.ceil(options.names.length / size) }, (_, i) =>
    options.names.slice(i * size, (i + 1) * size),
  );
  let found: readonly Company[] = [];
  for (const batch of batches) {
    const results = await Promise.all(batch.map((name) => findBoard(options.fetchBoard, name)));
    results.forEach((company, i) => {
      options.log(company === null ? `not found: ${batch[i]}` : `found: ${company.name} -> ${company.source}/${company.token}`);
    });
    found = [...found, ...results.filter((company): company is Company => company !== null)];
  }
  return found;
}

/** Appends found boards, skipping any board or company name already in the list. */
export function mergeCompanies(existing: readonly Company[], found: readonly Company[]): readonly Company[] {
  const boardKey = (company: Company): string => `${company.source}/${company.token}`;
  return found.reduce<readonly Company[]>((list, company) => {
    const known = list.some(
      (other) => boardKey(other) === boardKey(company) || other.name.toLowerCase() === company.name.toLowerCase(),
    );
    return known ? list : [...list, company];
  }, existing);
}
