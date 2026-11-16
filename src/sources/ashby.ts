import type { Company, RawJob } from '../types.ts';
import { asArray, asObject, asText, isDefined, textList, toIsoDate } from './parse.ts';

export function ashbyUrl(token: string): string {
  return `https://api.ashbyhq.com/posting-api/job-board/${token}?includeCompensation=true`;
}

function countryOf(value: unknown): unknown {
  return asObject(asObject(asObject(value)?.address)?.postalAddress)?.addressCountry;
}

function parseJob(company: Company, value: unknown): RawJob | null {
  const job = asObject(value);
  const externalId = asText(job?.id);
  const title = asText(job?.title);
  const url = asText(job?.jobUrl);
  if (job?.isListed === false) return null;
  if (job === null || externalId === null || title === null || url === null) {
    // Dropping a posting we cannot read would look like the company closed it, so the whole read fails instead.
    throw new Error(`Malformed posting in Ashby response for ${company.token}`);
  }
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
  return jobs.map((job) => parseJob(company, job)).filter(isDefined);
}
