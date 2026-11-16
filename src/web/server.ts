import { createServer } from 'node:http';
import type { IncomingMessage, Server, ServerResponse } from 'node:http';
import { getJob, getStats, listEvents, listJobs } from '../store/read.ts';
import type { Db } from '../store/schema.ts';
import { buildPrepUrl, renderFeed, renderJob, renderMessage } from './views.ts';
import type { FeedQuery } from './views.ts';

export interface AppOptions {
  readonly db: Db;
  /** Link to WOW42 interview prep; `{jobUrl}` is replaced with the URL-encoded posting link. */
  readonly prepUrlTemplate: string;
  readonly now: () => string;
  readonly log: (line: string) => void;
}

interface Reply {
  readonly status: number;
  readonly contentType: string;
  readonly body: string;
}

const PAGE_SIZE = 30;
const MAX_PAGE = 1000;
const MAX_QUERY_LENGTH = 100;
const HTML = 'text/html; charset=utf-8';
const JSON_TYPE = 'application/json; charset=utf-8';
const SECURITY_HEADERS: Readonly<Record<string, string>> = {
  'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'no-referrer',
};

class BadRequest extends Error {}

function oneOf<T extends string>(value: string | null, allowed: readonly T[], name: string): T | undefined {
  if (value === null || value === '') return undefined;
  const match = allowed.find((item) => item === value);
  if (match === undefined) throw new BadRequest(`${name} must be one of: ${allowed.join(', ')}`);
  return match;
}

function parsePage(value: string | null): number {
  if (value === null || value === '') return 1;
  const page = Number(value);
  if (!Number.isInteger(page) || page < 1 || page > MAX_PAGE) {
    throw new BadRequest(`page must be a whole number from 1 to ${MAX_PAGE}`);
  }
  return page;
}

function parseFeedQuery(params: URLSearchParams): FeedQuery {
  return {
    stack: oneOf(params.get('stack'), ['go', 'java'] as const, 'stack'),
    region: oneOf(params.get('region'), ['us', 'all'] as const, 'region') ?? 'us',
    liveOnly: params.get('live') === '1',
    remoteOnly: params.get('remote') === '1',
    q: (params.get('q') ?? '').trim().slice(0, MAX_QUERY_LENGTH),
    page: parsePage(params.get('page')),
  };
}

function loadFeed(db: Db, query: FeedQuery) {
  return listJobs(db, {
    stack: query.stack,
    region: query.region,
    liveOnly: query.liveOnly,
    remoteOnly: query.remoteOnly,
    q: query.q,
    includeClosed: false,
    limit: PAGE_SIZE,
    offset: (query.page - 1) * PAGE_SIZE,
  });
}

function html(status: number, body: string): Reply {
  return { status, contentType: HTML, body };
}

function json(status: number, payload: object): Reply {
  return { status, contentType: JSON_TYPE, body: JSON.stringify(payload) };
}

function jsonError(status: number, error: string): Reply {
  return json(status, { success: false, data: null, error });
}

function feedPage(options: AppOptions, params: URLSearchParams): Reply {
  const query = parseFeedQuery(params);
  const { jobs, total } = loadFeed(options.db, query);
  const view = { jobs, total, pageSize: PAGE_SIZE, query, stats: getStats(options.db), now: options.now() };
  return html(200, renderFeed(view));
}

function jobPage(options: AppOptions, id: number): Reply {
  const job = getJob(options.db, id);
  if (job === null) return html(404, renderMessage('Posting not found', 'It may have been removed.'));
  const prepUrl = buildPrepUrl(options.prepUrlTemplate, job.url);
  return html(200, renderJob({ job, events: listEvents(options.db, id), prepUrl, now: options.now() }));
}

function feedApi(options: AppOptions, params: URLSearchParams): Reply {
  const query = parseFeedQuery(params);
  const { jobs, total } = loadFeed(options.db, query);
  return json(200, { success: true, data: jobs, error: null, meta: { total, page: query.page, limit: PAGE_SIZE } });
}

function jobApi(options: AppOptions, id: number): Reply {
  const job = getJob(options.db, id);
  if (job === null) return jsonError(404, 'Posting not found');
  return json(200, { success: true, data: { ...job, events: listEvents(options.db, id) }, error: null });
}

function route(options: AppOptions, url: URL): Reply {
  const { pathname, searchParams } = url;
  const isApi = pathname.startsWith('/api/');
  try {
    if (pathname === '/') return feedPage(options, searchParams);
    if (pathname === '/api/jobs') return feedApi(options, searchParams);
    if (pathname === '/healthz') return json(200, { success: true, data: getStats(options.db), error: null });
    const jobMatch = /^(\/api)?\/jobs\/(\d{1,12})$/.exec(pathname);
    if (jobMatch !== null) {
      const id = Number(jobMatch[2]);
      return jobMatch[1] === undefined ? jobPage(options, id) : jobApi(options, id);
    }
    return isApi ? jsonError(404, 'Not found') : html(404, renderMessage('Page not found', 'There is nothing at this address.'));
  } catch (error) {
    if (!(error instanceof BadRequest)) throw error;
    return isApi ? jsonError(400, error.message) : html(400, renderMessage('Invalid filter', error.message));
  }
}

function send(request: IncomingMessage, response: ServerResponse, reply: Reply): void {
  response.writeHead(reply.status, { ...SECURITY_HEADERS, 'content-type': reply.contentType });
  response.end(request.method === 'HEAD' ? undefined : reply.body);
}

function handle(options: AppOptions, request: IncomingMessage, response: ServerResponse): void {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    response.writeHead(405, { ...SECURITY_HEADERS, allow: 'GET, HEAD' });
    response.end();
    return;
  }
  // Only the path and query are used, so the host part is a fixed placeholder.
  const url = URL.parse(request.url ?? '/', 'http://localhost');
  if (url === null) {
    send(request, response, html(400, renderMessage('Invalid address', 'This address could not be read.')));
    return;
  }
  try {
    send(request, response, route(options, url));
  } catch (error) {
    options.log(`${request.method} ${request.url}: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`);
    send(request, response, html(500, renderMessage('Something went wrong', 'Please try again in a moment.')));
  }
}

/** The feed, posting pages and JSON API over one database. Read-only: it never writes. */
export function createApp(options: AppOptions): Server {
  return createServer((request, response) => handle(options, request, response));
}
