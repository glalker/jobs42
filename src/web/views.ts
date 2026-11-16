import type { JobDetail, JobEvent, JobSummary, Stats } from '../store/read.ts';
import type { Liveness, Stack, Verdict } from '../types.ts';
import { STYLES } from './styles.ts';

export interface FeedQuery {
  readonly stack: Stack | undefined;
  readonly region: 'us' | 'all';
  readonly liveOnly: boolean;
  readonly remoteOnly: boolean;
  readonly q: string;
  readonly page: number;
}

export interface FeedView {
  readonly jobs: readonly JobSummary[];
  readonly total: number;
  readonly pageSize: number;
  readonly query: FeedQuery;
  readonly stats: Stats;
  readonly now: string;
}

export interface JobView {
  readonly job: JobDetail;
  readonly events: readonly JobEvent[];
  readonly prepUrl: string | null;
  readonly now: string;
}

const MS_PER_DAY = 86_400_000;
const MS_PER_HOUR = 3_600_000;

const VERDICT_LABELS: Readonly<Record<Verdict, string>> = {
  hiring: 'Actively hiring',
  unclear: 'Unclear',
  unlikely: 'Unlikely to be hiring',
  insufficient: 'Not enough history yet',
  closed: 'Closed',
};

const EVENT_LABELS: Readonly<Record<string, string>> = {
  published: 'First seen on the company board',
  reposted: 'Reposted under a new link',
  closed: 'No longer listed',
  reopened: 'Back on the board',
  title_changed: 'Title edited',
  text_changed: 'Description edited',
  salary_changed: 'Pay range changed',
};

const STACK_LABELS: Readonly<Record<Stack, string>> = { go: 'Go', java: 'Java' };

const HTML_ESCAPES: Readonly<Record<string, string>> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

export function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (char) => HTML_ESCAPES[char] ?? char);
}

/** Posting links come from third parties, so only http(s) targets are ever rendered. */
export function safeHref(url: string): string | null {
  try {
    const { protocol } = new URL(url);
    return protocol === 'https:' || protocol === 'http:' ? url : null;
  } catch {
    return null;
  }
}

export function buildPrepUrl(template: string, jobUrl: string): string {
  return template.replace('{jobUrl}', encodeURIComponent(jobUrl));
}

function ago(from: string, now: string): string {
  const elapsed = Math.max(0, Date.parse(now) - Date.parse(from));
  if (elapsed < MS_PER_DAY) {
    const hours = Math.floor(elapsed / MS_PER_HOUR);
    return hours < 1 ? 'less than an hour ago' : `${hours}h ago`;
  }
  const days = Math.floor(elapsed / MS_PER_DAY);
  return days === 1 ? '1 day ago' : `${days} days ago`;
}

function layout(title: string, body: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>${STYLES}</style>
</head>
<body>
<main>
<a class="brand" href="/">WOW42 · Live jobs</a>
${body}
</main>
</body>
</html>`;
}

function badge(liveness: Liveness): string {
  const score = liveness.score === null ? '' : ` · ${liveness.score}`;
  return `<span class="badge ${liveness.verdict}">${escapeHtml(VERDICT_LABELS[liveness.verdict])}${score}</span>`;
}

function stackTags(job: JobSummary): string {
  return job.stacks.map((stack) => `<span class="tag">${STACK_LABELS[stack]}</span>`).join('');
}

function metaLine(job: JobSummary): string {
  const parts = [job.companyName, job.location, ...(job.remote ? ['Remote'] : []), ...(job.salary === null ? [] : [job.salary])];
  return parts.map(escapeHtml).join(' · ');
}

/** The single reason shown on a feed card: the first warning if there is one, otherwise the first signal. */
function headlineReason(liveness: Liveness): string {
  const signal = liveness.signals.find((item) => item.kind === 'bad') ?? liveness.signals[0];
  return signal === undefined ? '' : `<span class="reason">${escapeHtml(signal.text)}</span>`;
}

function jobCard(job: JobSummary): string {
  return `<li>
<a class="job-title" href="/jobs/${job.id}">${escapeHtml(job.title)}</a>
<div class="meta">${metaLine(job)}</div>
<div class="row">${stackTags(job)}${badge(job.liveness)}${headlineReason(job.liveness)}</div>
</li>`;
}

function feedUrl(query: FeedQuery, page: number): string {
  const params = new URLSearchParams({
    ...(query.q === '' ? {} : { q: query.q }),
    ...(query.stack === undefined ? {} : { stack: query.stack }),
    ...(query.region === 'all' ? { region: 'all' } : {}),
    ...(query.liveOnly ? { live: '1' } : {}),
    ...(query.remoteOnly ? { remote: '1' } : {}),
    ...(page > 1 ? { page: String(page) } : {}),
  });
  const search = params.toString();
  return search === '' ? '/' : `/?${search}`;
}

function option(value: string, label: string, selected: boolean): string {
  return `<option value="${value}"${selected ? ' selected' : ''}>${label}</option>`;
}

function checkbox(name: string, value: string, label: string, checked: boolean): string {
  return `<label><input type="checkbox" name="${name}" value="${value}"${checked ? ' checked' : ''}> ${label}</label>`;
}

function filters(query: FeedQuery): string {
  return `<form class="filters" method="get" action="/">
<input type="search" name="q" value="${escapeHtml(query.q)}" placeholder="Title or company" aria-label="Search by title or company" maxlength="100">
<select name="stack" aria-label="Stack">
${option('', 'Go and Java', query.stack === undefined)}${option('go', 'Go', query.stack === 'go')}${option('java', 'Java', query.stack === 'java')}
</select>
${checkbox('live', '1', 'Hide unlikely', query.liveOnly)}
${checkbox('remote', '1', 'Remote only', query.remoteOnly)}
${checkbox('region', 'all', 'Include outside US', query.region === 'all')}
<button type="submit">Search</button>
</form>`;
}

function pager(view: FeedView): string {
  const { query, total, pageSize } = view;
  const previous = query.page > 1 ? `<a href="${escapeHtml(feedUrl(query, query.page - 1))}">← Newer</a>` : '<span></span>';
  const next = query.page * pageSize < total ? `<a href="${escapeHtml(feedUrl(query, query.page + 1))}">Older →</a>` : '<span></span>';
  return `<nav class="pages">${previous}${next}</nav>`;
}

export function renderFeed(view: FeedView): string {
  const { stats } = view;
  const updated = stats.lastRunAt === null ? 'not collected yet' : `updated ${ago(stats.lastRunAt, view.now)}`;
  const list =
    view.jobs.length === 0
      ? '<p class="empty">No postings match these filters.</p>'
      : `<ul class="jobs">${view.jobs.map(jobCard).join('\n')}</ul>`;
  return layout(
    'Live Go and Java jobs · WOW42',
    `<h1>Go and Java jobs that are actually hiring</h1>
<p class="sub">${stats.openJobs} open roles at ${stats.companies} companies, read straight from their career pages · ${escapeHtml(updated)}. Every posting is rated on whether it is still being hired for.</p>
${filters(view.query)}
<p class="meta">${view.total} matching</p>
${list}
${pager(view)}`,
  );
}

function historyItem(event: JobEvent): string {
  const label = EVENT_LABELS[event.kind] ?? event.kind;
  const detail = event.detail === null ? '' : ` <span class="reason">${escapeHtml(event.detail)}</span>`;
  return `<li><time datetime="${escapeHtml(event.at)}">${escapeHtml(event.at.slice(0, 10))}</time>${escapeHtml(label)}${detail}</li>`;
}

function actions(view: JobView): string {
  const original = safeHref(view.job.url);
  const prep = view.prepUrl === null || original === null ? null : safeHref(view.prepUrl);
  const prepButton =
    prep === null || view.job.closedAt !== null
      ? ''
      : `<a class="button" href="${escapeHtml(prep)}">Prepare for this interview</a>`;
  const originalButton =
    original === null
      ? ''
      : `<a class="button secondary" href="${escapeHtml(original)}" rel="noopener noreferrer nofollow">View original posting</a>`;
  return `<div class="actions">${prepButton}${originalButton}</div>`;
}

export function renderJob(view: JobView): string {
  const { job } = view;
  const signals = job.liveness.signals
    .map((signal) => `<li class="${signal.kind}">${escapeHtml(signal.text)}</li>`)
    .join('');
  return layout(
    `${job.title} at ${job.companyName} · WOW42`,
    `<h1>${escapeHtml(job.title)}</h1>
<p class="sub">${metaLine(job)}</p>
<div class="row">${stackTags(job)}${badge(job.liveness)}<span class="reason">First published ${escapeHtml(ago(job.postedAt, view.now))}</span></div>
${actions(view)}
<h2>Why this rating</h2>
<div class="panel"><ul class="signals">${signals}</ul></div>
<h2>Posting history</h2>
<div class="panel"><ol class="history">${view.events.map(historyItem).join('')}</ol></div>
<h2>Description</h2>
<div class="panel description">${escapeHtml(job.description)}</div>`,
  );
}

export function renderMessage(title: string, message: string): string {
  return layout(`${title} · WOW42`, `<h1>${escapeHtml(title)}</h1><p class="sub">${escapeHtml(message)}</p><a href="/">Back to the feed</a>`);
}
