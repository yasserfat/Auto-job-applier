import 'dotenv/config';
import path from 'node:path';

const ROOT = process.cwd();

function env(name: string, fallback = ''): string {
  return (process.env[name] ?? fallback).trim();
}

function bool(name: string, fallback: boolean): boolean {
  const v = env(name);
  if (!v) return fallback;
  return ['1', 'true', 'yes', 'on'].includes(v.toLowerCase());
}

function int(name: string, fallback: number): number {
  const n = Number.parseInt(env(name), 10);
  return Number.isFinite(n) ? n : fallback;
}

const args = new Set(process.argv.slice(2));

// `npm run dry` forces dry-run regardless of .env; otherwise .env decides (default: true).
const dryRun = args.has('--dry') ? true : bool('DRY_RUN', true);

export const config = {
  root: ROOT,
  dryRun,
  fetchOnly: args.has('--fetch-only'),
  sendOnly: args.has('--send-only'),

  anthropicApiKey: env('ANTHROPIC_API_KEY') || env('Claude_API_key'),
  aiModel: env('AI_MODEL', 'claude-haiku-4-5'),

  gmailUser: env('GMAIL_USER'),
  gmailAppPassword: env('GMAIL_APP_PASSWORD').replace(/\s+/g, ''),
  gmailOAuth: {
    clientId: env('GMAIL_OAUTH_CLIENT_ID'),
    clientSecret: env('GMAIL_OAUTH_CLIENT_SECRET'),
    refreshToken: env('GMAIL_OAUTH_REFRESH_TOKEN'),
  },
  reportTo: env('REPORT_TO') || env('GMAIL_USER'),

  maxApplicationsPerRun: int('MAX_APPLICATIONS_PER_RUN', 15),
  sendDelaySeconds: int('SEND_DELAY_SECONDS', 30),
  maxAgeDays: int('MAX_AGE_DAYS', 15),
  radiusKm: int('RADIUS_KM', 25),
  maxPagesPerQuery: int('MAX_PAGES_PER_QUERY', 10),
  maxNewJobsPerRun: int('MAX_NEW_JOBS_PER_RUN', 500),
  reviewConcurrency: int('REVIEW_CONCURRENCY', 5),

  // Dry runs use their own database so drafts never block real applications later.
  dbPath: path.join(ROOT, dryRun ? 'jobs.dry.db' : 'jobs.db'),
  logsDir: path.join(ROOT, 'logs'),
  outDir: path.join(ROOT, 'output'),
  excelPath: path.join(ROOT, 'external_jobs.xlsx'),
  profilePath: path.join(ROOT, 'config', 'profile.json'),
  cvPath: path.join(ROOT, env('CV_PATH', 'assets/cv.pdf')),
};

/** Values that must never appear in logs. */
export const secrets = [config.anthropicApiKey, config.gmailAppPassword, env('GMAIL_APP_PASSWORD'),
  config.gmailOAuth.clientSecret, config.gmailOAuth.refreshToken].filter((s) => s.length >= 6);
