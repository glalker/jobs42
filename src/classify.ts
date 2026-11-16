import { extractSalary, hashContent, normalizeTitle } from './text.ts';
import type { ClassifiedJob, RawJob, Region, Stack } from './types.ts';

const MAX_LOCATIONS_SHOWN = 3;

const ENGINEERING_TITLE =
  /\b(?:engineer|engineering manager|developer|programmer|architect|sre|swe|member of technical staff|tech(?:nical)? lead)\b/i;
const NON_ENGINEERING_TITLE =
  /\b(?:recruit\w*|sourcer|talent|sales|pre-?sales|solutions?|support|account|marketing|customer|success|field)\b/i;

const OTHER_LANGUAGES =
  '(?:Python|Java|Rust|C\\+\\+|C#|Kotlin|TypeScript|JavaScript|Scala|Ruby|Node(?:\\.js)?|Elixir|Swift|PHP|Erlang|Haskell)';
const LIST_JOINER = '\\s*(?:,|/|&|\\bor\\b|\\band\\b)\\s*(?:(?:or|and)\\s+)?';
const NOT_GO_TO = '(?![- ][Tt]o\\b)';

/** "Go" is also an English word, so it only counts next to other languages or in a technical phrase. */
const GO_IN_TEXT: readonly RegExp[] = [
  /\bgolang\b/i,
  /\(Go\)/,
  /[,(/]\s*Go\s*[,)/]/,
  new RegExp(`${OTHER_LANGUAGES}${LIST_JOINER}Go\\b${NOT_GO_TO}`),
  new RegExp(`\\bGo${LIST_JOINER}${OTHER_LANGUAGES}`),
  new RegExp(
    `\\b(?:in|with|using|use|uses|used|of|know|write|writing)\\s+Go\\b${NOT_GO_TO}(?=\\s*(?:[.,;:)(/]|$|and\\b|or\\b|is\\b|as\\b|for\\b|on\\b))`,
  ),
  /\bGo\s+(?i:developers?|engineers?|programming|language|services?|microservices?|backend|codebase|experience|code|stack|applications?|routines?|skills?|proficiency|expertise|knowledge|development)\b/,
];
const GO_IN_TITLE = new RegExp(`\\bGo\\b${NOT_GO_TO}`);
const JAVA_IN_TEXT: readonly RegExp[] = [/\bjava\b/i, /\bspring boot\b/i, /\bJVM\b/];

const US_COUNTRY_HINT = /^(?:us|usa|u\.s\.a?\.?|united states(?: of america)?)$/i;
const US_STATE_CODES =
  'AL|AK|AZ|AR|CA|CO|CT|DE|FL|GA|HI|ID|IL|IN|IA|KS|KY|LA|ME|MD|MA|MI|MN|MS|MO|MT|NE|NV|NH|NJ|NM|NY|NC|ND|OH|OK|OR|PA|RI|SC|SD|TN|TX|UT|VT|VA|WA|WV|WI|WY|DC';
const US_LOCATION: readonly RegExp[] = [
  /\b(?:United States|USA|U\.S\.A?\.?)(?=\W|$)/i,
  /\bUS\b/,
  /\b(?:California|New York|Texas|Washington|Massachusetts|Colorado|Illinois|Florida|Virginia|North Carolina|Oregon|Utah|Pennsylvania|Arizona|New Jersey|Ohio|Michigan|Minnesota|Tennessee|Maryland)\b/i,
  /\b(?:San Francisco|NYC|Seattle|Austin|Boston|Chicago|Denver|Los Angeles|Atlanta|Mountain View|Palo Alto|Sunnyvale|San Jose|San Mateo|Menlo Park|Redwood City|Bellevue|Miami|Dallas|Houston|Pittsburgh|Philadelphia|Raleigh|Salt Lake City|San Diego|Bay Area)\b/i,
];
/** A trailing two-letter code is a US state only when the place is not plainly abroad ("Berlin, DE", "Toronto, CA"). */
const US_STATE_SUFFIX = new RegExp(`,\\s*(?:${US_STATE_CODES})\\s*(?:$|,)`);
const FOREIGN_PLACE =
  /\b(?:Canada|Toronto|Vancouver|Montreal|Ottawa|India|Bengaluru|Bangalore|Hyderabad|Pune|Mumbai|Delhi|Gurgaon|Gurugram|Chennai|Noida|Israel|Tel Aviv|Germany|Berlin|Munich|Hamburg|Colombia|Bogot[aá]|Medell[ií]n|Indonesia|Jakarta|Argentina|Buenos Aires|Morocco|Romania|Bucharest|Montenegro|Mexico|Brazil|S[aã]o Paulo|United Kingdom|London|Ireland|Dublin|France|Paris|Netherlands|Amsterdam|Poland|Spain|Singapore|Japan|Tokyo|Australia|Sydney)\b/i;
const COUNTRYLESS_LOCATIONS: ReadonlySet<string> = new Set([
  '',
  'anywhere',
  'worldwide',
  'global',
  'distributed',
  'multiple locations',
  'hybrid',
  'various',
  'north america',
  'americas',
]);

export function isEngineeringTitle(title: string): boolean {
  return ENGINEERING_TITLE.test(title) && !NON_ENGINEERING_TITLE.test(title);
}

export function detectStacks(title: string, description: string): readonly Stack[] {
  const text = `${title}\n${description}`;
  const hasGo = GO_IN_TITLE.test(title) || GO_IN_TEXT.some((pattern) => pattern.test(text));
  const hasJava = JAVA_IN_TEXT.some((pattern) => pattern.test(text));
  return [...(hasGo ? (['go'] as const) : []), ...(hasJava ? (['java'] as const) : [])];
}

function saysNothingAboutCountry(location: string): boolean {
  const stripped = location.toLowerCase().replace(/remote/g, '').replace(/[^a-z ]+/g, ' ').replace(/\s+/g, ' ').trim();
  return COUNTRYLESS_LOCATIONS.has(stripped);
}

function isUsLocation(location: string): boolean {
  if (US_LOCATION.some((pattern) => pattern.test(location))) return true;
  return US_STATE_SUFFIX.test(location) && !FOREIGN_PLACE.test(location);
}

export function detectRegion(locations: readonly string[], countryHints: readonly string[]): Region {
  const hints = countryHints.map((hint) => hint.trim()).filter((hint) => hint.length > 0);
  const inUs =
    hints.some((hint) => US_COUNTRY_HINT.test(hint)) ||
    locations.some(isUsLocation);
  if (inUs) return 'us';
  if (hints.length > 0) return 'other';
  return locations.every(saysNothingAboutCountry) ? 'unknown' : 'other';
}

function describeLocation(job: RawJob): string {
  const named = job.locations.map((location) => location.trim()).filter((location) => location.length > 0);
  if (named.length > 0) return named.slice(0, MAX_LOCATIONS_SHOWN).join(' · ');
  return job.remote ? 'Remote' : 'Not specified';
}

/** Keeps only engineering roles that name Go or Java; returns null for everything else. */
export function classify(job: RawJob): ClassifiedJob | null {
  if (!isEngineeringTitle(job.title)) return null;
  const stacks = detectStacks(job.title, job.description);
  if (stacks.length === 0) return null;
  return {
    ...job,
    salary: job.salary ?? extractSalary(job.description),
    stacks,
    region: detectRegion(job.locations, job.countryHints),
    location: describeLocation(job),
    titleKey: normalizeTitle(job.title),
    contentHash: hashContent(job.title, job.description),
  };
}
