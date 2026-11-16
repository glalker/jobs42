import { readFileSync } from 'node:fs';
import { isBoardToken, isSource } from './sources/index.ts';
import type { Company } from './types.ts';

function parseCompany(value: unknown, position: number): Company {
  const entry = typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};
  const { source, token, name } = entry;
  if (!isSource(source) || !isBoardToken(token) || typeof name !== 'string' || name.trim() === '') {
    throw new Error(`Company list entry ${position} needs a known source, a slug token and a name`);
  }
  return { source, token, name: name.trim() };
}

export function parseCompanies(value: unknown): readonly Company[] {
  if (!Array.isArray(value)) {
    throw new Error('Company list must be a list of {source, token, name}');
  }
  return value.map((entry, index) => parseCompany(entry, index + 1));
}

export function loadCompanies(path: string): readonly Company[] {
  return parseCompanies(JSON.parse(readFileSync(path, 'utf8')) as unknown);
}
