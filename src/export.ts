import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { getJob, getStats, listEvents, listJobs } from './store/read.ts';
import type { JobSummary } from './store/read.ts';
import type { Db } from './store/schema.ts';
import { STYLES } from './web/styles.ts';
import { buildPrepUrl, safeHref } from './web/views.ts';

export interface ExportOptions {
  readonly db: Db;
  readonly outDir: string;
  /** ISO timestamp shown as the snapshot time. */
  readonly now: string;
  readonly prepUrlTemplate: string;
}

const MAX_EXPORTED_JOBS = 5000;
const APP_SCRIPT = readFileSync(new URL('./static/app.js', import.meta.url), 'utf8');
const CONTENT_SECURITY_POLICY =
  "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'; base-uri 'none'";
const EXTRA_STYLES = `
details.how { background: var(--surface); border: 1px solid var(--line); border-radius: 12px; padding: 12px 16px; margin-bottom: 18px; }
details.how summary { cursor: pointer; font-weight: 600; }
details.how ul { margin: 10px 0 0; padding-left: 20px; color: var(--muted); }
.more { margin: 18px auto 0; display: block; }
`;

/** JSON that is safe inside a script element: no sequence in it can close the element. */
function embedJson(value: unknown): string {
  return JSON.stringify(value).replace(/</g, '\\u003c');
}

function renderPage(jobs: readonly JobSummary[], companies: number, now: string): string {
  const data = embedJson({ jobs, companies, snapshotAt: now });
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="${CONTENT_SECURITY_POLICY}">
<title>Live Go and Java jobs · WOW42</title>
<style>${STYLES}${EXTRA_STYLES}</style>
</head>
<body>
<main>
<a class="brand" href="#/">WOW42 · Live jobs</a>
<div id="app"></div>
</main>
<script id="data" type="application/json">${data}</script>
<script>${APP_SCRIPT}</script>
</body>
</html>
`;
}

function writeJobFile(options: ExportOptions, jobsDir: string, id: number): void {
  const job = getJob(options.db, id);
  if (job === null) return;
  const url = safeHref(job.url);
  const detail = {
    description: job.description,
    url,
    prepUrl: url === null ? null : buildPrepUrl(options.prepUrlTemplate, url),
    events: listEvents(options.db, id),
  };
  writeFileSync(join(jobsDir, `${id}.json`), JSON.stringify(detail));
}

/** Writes a snapshot of the US feed as static files that any file host can serve. */
export function exportStaticSite(options: ExportOptions): { readonly jobs: number } {
  const { jobs } = listJobs(options.db, {
    region: 'us',
    liveOnly: false,
    includeClosed: false,
    limit: MAX_EXPORTED_JOBS,
    offset: 0,
  });
  const jobsDir = join(options.outDir, 'jobs');
  rmSync(jobsDir, { recursive: true, force: true });
  mkdirSync(jobsDir, { recursive: true });
  jobs.forEach((job) => writeJobFile(options, jobsDir, job.id));
  writeFileSync(join(options.outDir, 'index.html'), renderPage(jobs, getStats(options.db).companies, options.now));
  // Tells GitHub Pages to serve the files as they are.
  writeFileSync(join(options.outDir, '.nojekyll'), '');
  return { jobs: jobs.length };
}
