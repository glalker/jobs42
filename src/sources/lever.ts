import { htmlToText } from '../text.ts';
import type { Company, RawJob } from '../types.ts';
import { MALFORMED, asArray, asObject, asText, collectJobs, textList, toIsoDate } from './parse.ts';
import type { ParsedEntry } from './parse.ts';
import type { JsonObject } from './parse.ts';

export function leverUrl(token: string): string {
  return `https://api.lever.co/v0/postings/${token}?mode=json`;
}

function describe(job: JsonObject): string {
  const lists = asArray(job.lists).flatMap((item) => {
    const list = asObject(item);
    return [asText(list?.text), htmlToText(asText(list?.content) ?? '')];
  });
  return textList([job.descriptionPlain, ...lists, job.additionalPlain]).join('\n');
}

function formatSalary(value: unknown): string | null {
  const range = asObject(value);
  const { min, max } = range ?? {};
  if (typeof min !== 'number' || typeof max !== 'number') return null;
  const currency = asText(range?.currency) ?? 'USD';
  const amount = (n: number): string => n.toLocaleString('en-US');
  return currency === 'USD' ? `$${amount(min)} - $${amount(max)}` : `${amount(min)} - ${amount(max)} ${currency}`;
}

function parseJob(company: Company, value: unknown): ParsedEntry {
  const job = asObject(value);
  const externalId = asText(job?.id);
  const title = asText(job?.text);
  const url = asText(job?.hostedUrl);
  if (job === null || externalId === null || title === null || url === null) return MALFORMED;
  const categories = asObject(job.categories);
  const allLocations = textList(asArray(categories?.allLocations));
  return {
    source: 'lever',
    company: company.token,
    companyName: company.name,
    externalId,
    url,
    title,
    locations: allLocations.length > 0 ? allLocations : textList([categories?.location]),
    countryHints: textList([job.country]),
    remote: asText(job.workplaceType)?.toLowerCase() === 'remote',
    postedAt: toIsoDate(job.createdAt),
    description: describe(job),
    salary: formatSalary(job.salaryRange),
  };
}

export function parseLever(company: Company, payload: unknown): readonly RawJob[] {
  if (!Array.isArray(payload)) {
    throw new Error(`Unexpected Lever response for ${company.token}`);
  }
  return collectJobs(`Lever response for ${company.token}`, payload, (job) => parseJob(company, job));
}
