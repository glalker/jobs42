import type { Company, RawJob } from '../types.ts';
import { MALFORMED, asArray, asObject, asText, collectJobs, textList, toIsoDate } from './parse.ts';
import type { ParsedEntry } from './parse.ts';

export function ashbyUrl(token: string): string {
  return `https://api.ashbyhq.com/posting-api/job-board/${token}?includeCompensation=true`;
}

function countryOf(value: unknown): unknown {
  return asObject(asObject(asObject(value)?.address)?.postalAddress)?.addressCountry;
}

function parseJob(company: Company, value: unknown): ParsedEntry {
  const job = asObject(value);
  const externalId = asText(job?.id);
  const title = asText(job?.title);
  const url = asText(job?.jobUrl);
  if (job?.isListed === false) return null;
  if (job === null || externalId === null || title === null || url === null) return MALFORMED;
  const secondary = asArray(job.secondaryLocations);
  const compensation = asObject(job.compensation);
  return {
    source: 'ashby',
    company: company.token,
    companyName: company.name,
    externalId,
    url,
    title,
    locations: textList([job.location, ...secondary.map((item) => asObject(item)?.location)]),
    countryHints: textList([countryOf(job), ...secondary.map(countryOf)]),
    remote: job.isRemote === true,
    postedAt: toIsoDate(job.publishedAt),
    description: asText(job.descriptionPlain) ?? '',
    salary:
      asText(compensation?.scrapeableCompensationSalarySummary) ?? asText(compensation?.compensationTierSummary),
  };
}

export function parseAshby(company: Company, payload: unknown): readonly RawJob[] {
  const jobs = asObject(payload)?.jobs;
  if (!Array.isArray(jobs)) {
    throw new Error(`Unexpected Ashby response for ${company.token}`);
  }
  return collectJobs(`Ashby response for ${company.token}`, jobs, (job) => parseJob(company, job));
}
