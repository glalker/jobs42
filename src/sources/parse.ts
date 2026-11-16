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

export function isDefined<T>(value: T | null): value is T {
  return value !== null;
}
