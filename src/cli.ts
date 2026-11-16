import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { loadCompanies } from './companies.ts';
import { exportStaticSite } from './export.ts';
import { fetchJson } from './http.ts';
import { runIngest } from './ingest.ts';
import { createBoardFetcher } from './sources/index.ts';
import { getStats } from './store/read.ts';
import { openDatabase } from './store/schema.ts';
import type { Db } from './store/schema.ts';
import { createApp } from './web/server.ts';

const MS_PER_HOUR = 3_600_000;
const DEFAULT_PORT = 4242;
const DEFAULT_INGEST_INTERVAL_HOURS = 4;
const USAGE = `Usage:
  node src/cli.ts ingest   read every company board once and update the database
  node src/cli.ts serve    serve the feed and re-read the boards on a schedule
  node src/cli.ts export   write a static snapshot of the feed to docs/ (for GitHub Pages)

Environment:
  JOBS42_DB               database file (default data/jobs42.db)
  JOBS42_COMPANIES        company list (default companies.json)
  PORT, HOST              where to listen (default 127.0.0.1:${DEFAULT_PORT})
  INGEST_INTERVAL_HOURS   hours between board reads while serving, 0 to disable (default ${DEFAULT_INGEST_INTERVAL_HOURS})
  WOW42_PREP_URL          prep link template, {jobUrl} is replaced with the posting link`;

interface Config {
  readonly dbPath: string;
  readonly companiesPath: string;
  readonly port: number;
  readonly host: string;
  readonly ingestIntervalHours: number;
  readonly prepUrlTemplate: string;
}

function log(line: string): void {
  process.stdout.write(`${new Date().toISOString()} ${line}\n`);
}

function numberFromEnv(name: string, fallback: number, min: number, max: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < min || value > max) {
    throw new Error(`${name} must be a number from ${min} to ${max}, got "${raw}"`);
  }
  return value;
}

function readConfig(): Config {
  return {
    dbPath: process.env.JOBS42_DB ?? 'data/jobs42.db',
    companiesPath: process.env.JOBS42_COMPANIES ?? 'companies.json',
    port: numberFromEnv('PORT', DEFAULT_PORT, 0, 65_535),
    host: process.env.HOST ?? '127.0.0.1',
    ingestIntervalHours: numberFromEnv('INGEST_INTERVAL_HOURS', DEFAULT_INGEST_INTERVAL_HOURS, 0, 168),
    prepUrlTemplate: process.env.WOW42_PREP_URL ?? 'https://wow42.tech/?job={jobUrl}',
  };
}

function openConfiguredDatabase(config: Config): Db {
  mkdirSync(dirname(config.dbPath), { recursive: true });
  return openDatabase(config.dbPath);
}

async function ingest(config: Config, db: Db): Promise<void> {
  const companies = loadCompanies(config.companiesPath);
  log(`Reading ${companies.length} company boards`);
  const summary = await runIngest({
    db,
    companies,
    fetchBoard: createBoardFetcher(fetchJson),
    now: new Date().toISOString(),
    log,
  });
  log(`Done: ${summary.boards - summary.failed}/${summary.boards} boards read, ${summary.inserted} new, ${summary.updated} edited, ${summary.closed} closed`);
}

function isStale(lastRunAt: string | null, intervalMs: number): boolean {
  return lastRunAt === null || Date.now() - Date.parse(lastRunAt) >= intervalMs;
}

/** Re-reads the boards on a timer, never running two reads at once. */
function scheduleIngest(config: Config, db: Db): void {
  if (config.ingestIntervalHours === 0) return;
  const intervalMs = config.ingestIntervalHours * MS_PER_HOUR;
  const state = { running: false };
  const tick = (): void => {
    if (state.running) return;
    state.running = true;
    ingest(config, db)
      .catch((error: unknown) => log(`Ingest failed: ${error instanceof Error ? error.message : String(error)}`))
      .finally(() => {
        state.running = false;
      });
  };
  setInterval(tick, intervalMs);
  if (isStale(getStats(db).lastRunAt, intervalMs)) tick();
}

function serve(config: Config, db: Db): void {
  const app = createApp({ db, prepUrlTemplate: config.prepUrlTemplate, now: () => new Date().toISOString(), log });
  app.listen(config.port, config.host, () => log(`Feed at http://${config.host}:${config.port}`));
  scheduleIngest(config, db);
}

async function main(command: string | undefined): Promise<void> {
  if (command !== 'ingest' && command !== 'serve' && command !== 'export') {
    process.stdout.write(`${USAGE}\n`);
    process.exitCode = command === undefined ? 0 : 1;
    return;
  }
  const config = readConfig();
  const db = openConfiguredDatabase(config);
  if (command === 'ingest') {
    await ingest(config, db);
    return;
  }
  if (command === 'export') {
    const outDir = process.env.JOBS42_EXPORT_DIR ?? 'docs';
    const result = exportStaticSite({ db, outDir, now: new Date().toISOString(), prepUrlTemplate: config.prepUrlTemplate });
    log(`Wrote ${result.jobs} postings to ${outDir}/`);
    return;
  }
  serve(config, db);
}

main(process.argv[2]).catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
