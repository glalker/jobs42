import type { RawJob } from '../types.ts';

export type JsonObject = Readonly<Record<string, unknown>>;

export function asObject(value: unknown): JsonObject | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as JsonObject) : null;
}

export function asArray(value: unknown): readonly unknown[] {
  return Array.isArray(value) ? value : [];
}

/** Non-empty trimmed text; numbers are accepted because some boards use numeric ids. */
export function asText(value: unknown): string | null {
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function textList(values: readonly unknown[]): readonly string[] {
  return [...new Set(values.map(asText).filter((value): value is string => value !== null))];
}

/** Accepts an ISO string or epoch milliseconds; anything unparseable becomes null. */
export function toIsoDate(value: unknown): string | null {
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  const time = typeof value === 'number' ? value : Date.parse(value);
  return Number.isFinite(time) ? new Date(time).toISOString() : null;
}

/** Marks a posting entry that lacks an id, title or link. */
export const MALFORMED = Symbol('malformed');
export type ParsedEntry = RawJob | null | typeof MALFORMED;

/**
 * Keeps the readable postings. A few broken entries are skipped, but when at least half are broken the
 * format has probably changed, and the read fails so the board's postings are not closed by mistake.
 */
export function collectJobs(label: string, entries: readonly unknown[], parse: (entry: unknown) => ParsedEntry): readonly RawJob[] {
  const results = entries.map(parse);
  const malformed = results.filter((result) => result === MALFORMED).length;
  if (malformed > 0 && malformed * 2 >= entries.length) {
    throw new Error(`Malformed postings in ${label}: ${malformed} of ${entries.length}`);
  }
  return results.filter((result): result is RawJob => result !== null && result !== MALFORMED);
}
