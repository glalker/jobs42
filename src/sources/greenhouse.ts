import { htmlToText } from '../text.ts';
import type { Company, RawJob } from '../types.ts';
import { MALFORMED, asArray, asObject, asText, collectJobs, textList, toIsoDate } from './parse.ts';
import type { ParsedEntry } from './parse.ts';

export function greenhouseUrl(token: string): string {
  return `https://boards-api.greenhouse.io/v1/boards/${token}/jobs?content=true`;
}

function parseJob(company: Company, value: unknown): ParsedEntry {
  const job = asObject(value);
  const externalId = asText(job?.id);
  const title = asText(job?.title);
  const url = asText(job?.absolute_url);
  if (job === null || externalId === null || title === null || url === null) return MALFORMED;
  const officeLocations = asArray(job.offices).map((office) => asObject(office)?.location);
  return {
    source: 'greenhouse',
    company: company.token,
    companyName: asText(job.company_name) ?? company.name,
    externalId,
    url,
    title,
    locations: textList([asObject(job.location)?.name, ...officeLocations]),
    countryHints: [],
    remote: false,
    postedAt: toIsoDate(job.first_published),
    description: htmlToText(asText(job.content) ?? ''),
    salary: null,
  };
}

export function parseGreenhouse(company: Company, payload: unknown): readonly RawJob[] {
  const jobs = asObject(payload)?.jobs;
  if (!Array.isArray(jobs)) {
    throw new Error(`Unexpected Greenhouse response for ${company.token}`);
  }
  return collectJobs(`Greenhouse response for ${company.token}`, jobs, (job) => parseJob(company, job));
}
