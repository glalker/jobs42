import { DatabaseSync } from 'node:sqlite';

export type Db = DatabaseSync;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS jobs (
  id                 INTEGER PRIMARY KEY,
  source             TEXT NOT NULL,
  company            TEXT NOT NULL,
  company_name       TEXT NOT NULL,
  external_id        TEXT NOT NULL,
  url                TEXT NOT NULL,
  title              TEXT NOT NULL,
  title_key          TEXT NOT NULL,
  location           TEXT NOT NULL,
  region             TEXT NOT NULL,
  remote             INTEGER NOT NULL,
  stacks             TEXT NOT NULL,
  salary             TEXT,
  description        TEXT NOT NULL,
  content_hash       TEXT NOT NULL,
  posted_at          TEXT,
  original_posted_at TEXT NOT NULL,
  first_seen_at      TEXT NOT NULL,
  last_seen_at       TEXT NOT NULL,
  closed_at          TEXT,
  repost_of          INTEGER REFERENCES jobs(id),
  repost_count       INTEGER NOT NULL DEFAULT 0,
  liveness_verdict   TEXT NOT NULL DEFAULT 'insufficient',
  liveness_score     INTEGER,
  liveness_signals   TEXT NOT NULL DEFAULT '[]',
  UNIQUE (source, company, external_id)
);
CREATE INDEX IF NOT EXISTS jobs_feed ON jobs (closed_at, region, original_posted_at);

CREATE TABLE IF NOT EXISTS job_events (
  id     INTEGER PRIMARY KEY,
  job_id INTEGER NOT NULL REFERENCES jobs(id),
  at     TEXT NOT NULL,
  kind   TEXT NOT NULL,
  detail TEXT
);
CREATE INDEX IF NOT EXISTS job_events_job ON job_events (job_id, id);

CREATE TABLE IF NOT EXISTS board_runs (
  id      INTEGER PRIMARY KEY,
  source  TEXT NOT NULL,
  company TEXT NOT NULL,
  at      TEXT NOT NULL,
  ok      INTEGER NOT NULL,
  fetched INTEGER NOT NULL,
  matched INTEGER NOT NULL,
  error   TEXT
);
`;

/** Opens (and creates if needed) the database. Pass ':memory:' for a throwaway one. */
export function openDatabase(path: string): Db {
  const db = new DatabaseSync(path);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
  db.exec(SCHEMA);
  return db;
}

/** Runs `work` in one transaction: everything is written, or nothing is. */
export function inTransaction<T>(db: Db, work: () => T): T {
  db.exec('BEGIN');
  try {
    const result = work();
    db.exec('COMMIT');
    return result;
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}
