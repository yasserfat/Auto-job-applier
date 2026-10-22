import Database from 'better-sqlite3';
import { config } from './config.js';

export type JobStatus =
  | 'applied'   // application email sent to the employer
  | 'drafted'   // dry run: application sent to me instead
  | 'queued'    // suitable email job waiting for a free slot (per-run cap)
  | 'manual'    // suitable, but apply via link/phone/unclear → external_jobs.xlsx
  | 'skipped'   // not suitable
  | 'failed'    // sending failed (not retried automatically, to avoid duplicates)
  | 'error';    // fetch/AI error, retried next run (max 3 attempts)

export type JobRow = {
  id: number;
  uuid: string;
  title: string;
  company: string;
  location: string;
  link: string;
  posted_at: string;
  apply_method: string | null;
  apply_target: string | null;
  wa_link: string | null;
  decision: 'suitable' | 'unsuitable' | null;
  reason: string | null;
  status: JobStatus;
  review_json: string | null;
  sent_to: string | null;
  attempts: number;
  created_at: string;
  updated_at: string;
};

export const db = new Database(config.dbPath);
db.pragma('journal_mode = WAL');
db.exec(`
  CREATE TABLE IF NOT EXISTS jobs (
    id            INTEGER PRIMARY KEY,
    uuid          TEXT NOT NULL,
    title         TEXT NOT NULL,
    company       TEXT NOT NULL,
    location      TEXT NOT NULL DEFAULT '',
    link          TEXT NOT NULL,
    posted_at     TEXT NOT NULL DEFAULT '',
    apply_method  TEXT,
    apply_target  TEXT,
    wa_link       TEXT,
    decision      TEXT,
    reason        TEXT,
    status        TEXT NOT NULL,
    review_json   TEXT,
    sent_to       TEXT,
    attempts      INTEGER NOT NULL DEFAULT 0,
    created_at    TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
    updated_at    TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
  );
  CREATE INDEX IF NOT EXISTS jobs_status ON jobs(status);
`);

const MAX_ATTEMPTS = 3;

/** True when the job was already handled (anything except a retryable error). */
export function isHandled(id: number): boolean {
  const row = db.prepare('SELECT status, attempts FROM jobs WHERE id = ?').get(id) as Pick<JobRow, 'status' | 'attempts'> | undefined;
  if (!row) return false;
  return row.status !== 'error' || row.attempts >= MAX_ATTEMPTS;
}

export function upsertJob(job: Partial<JobRow> & Pick<JobRow, 'id' | 'uuid' | 'title' | 'company' | 'link' | 'status'>) {
  const cols = Object.keys(job);
  const sql = `INSERT INTO jobs (${cols.join(', ')}) VALUES (${cols.map((c) => '@' + c).join(', ')})
    ON CONFLICT(id) DO UPDATE SET ${cols.filter((c) => c !== 'id').map((c) => `${c} = excluded.${c}`).join(', ')},
    updated_at = datetime('now', 'localtime')`;
  db.prepare(sql).run(job);
}

export function markError(job: Pick<JobRow, 'id' | 'uuid' | 'title' | 'company' | 'link'>, reason: string) {
  db.prepare(`INSERT INTO jobs (id, uuid, title, company, link, status, reason, attempts)
    VALUES (@id, @uuid, @title, @company, @link, 'error', @reason, 1)
    ON CONFLICT(id) DO UPDATE SET status = 'error', reason = @reason, attempts = attempts + 1,
    updated_at = datetime('now', 'localtime')`).run({ ...job, reason });
}

export function setStatus(id: number, status: JobStatus, extra: { reason?: string; sent_to?: string } = {}) {
  db.prepare(`UPDATE jobs SET status = @status, reason = COALESCE(@reason, reason), sent_to = COALESCE(@sent_to, sent_to),
    updated_at = datetime('now', 'localtime') WHERE id = @id`)
    .run({ id, status, reason: extra.reason ?? null, sent_to: extra.sent_to ?? null });
}

export function jobsByStatus(status: JobStatus): JobRow[] {
  return db.prepare('SELECT * FROM jobs WHERE status = ? ORDER BY created_at').all(status) as JobRow[];
}

export function allManualJobs(): JobRow[] {
  return db.prepare("SELECT * FROM jobs WHERE status = 'manual' ORDER BY created_at DESC").all() as JobRow[];
}
