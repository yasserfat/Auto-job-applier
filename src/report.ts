import { existsSync } from 'node:fs';
import { config } from './config.js';
import { log, logFile } from './log.js';
import { sendMail } from './mailer.js';

export type ReportItem = { title: string; company: string; link: string; note?: string; target?: string };

export class RunSummary {
  found = 0;
  newJobs = 0;
  applied: ReportItem[] = [];
  drafted: ReportItem[] = [];
  manual: ReportItem[] = [];
  skipped: ReportItem[] = [];
  queued: ReportItem[] = [];
  failed: ReportItem[] = [];
  errors: string[] = [];
  warnings: string[] = [];
  fatal: Error | null = null;
}

const esc = (s = '') => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

function section(title: string, items: ReportItem[], empty: string): string {
  const rows = items.map((i) =>
    `<li><a href="${esc(i.link)}">${esc(i.title)}</a> · ${esc(i.company)}` +
    (i.target ? `<br><small>Apply: ${/^https?:/.test(i.target) ? `<a href="${esc(i.target)}">${esc(i.target)}</a>` : esc(i.target)}</small>` : '') +
    (i.note ? `<br><small style="color:#555">${esc(i.note)}</small>` : '') + '</li>').join('');
  return `<h3>${esc(title)} (${items.length})</h3>` + (items.length ? `<ul>${rows}</ul>` : `<p style="color:#777">${empty}</p>`);
}

function textSection(title: string, items: ReportItem[]): string {
  return `${title} (${items.length})\n` + items.map((i) => `- ${i.title} · ${i.company}\n  ${i.target ?? i.link}${i.note ? `\n  ${i.note}` : ''}`).join('\n') + '\n';
}

export async function sendReport(s: RunSummary) {
  const date = new Date().toLocaleDateString('de-AT');
  const problem = s.fatal ? 'CRASHED' : s.found === 0 ? '0 jobs found' : '';
  const sentCount = config.dryRun ? s.drafted.length : s.applied.length;
  const subject = `${config.dryRun ? '[DRY RUN] ' : ''}AMS bot ${date}: ${sentCount} ${config.dryRun ? 'drafts' : 'applied'}, ` +
    `${s.manual.length} manual, ${s.skipped.length} skipped${problem ? ` ⚠ ${problem}` : ''}`;

  const alerts = [
    s.fatal ? `<b>The run crashed:</b><pre>${esc(s.fatal.stack ?? s.fatal.message)}</pre>` : '',
    s.found === 0 && !s.fatal ? '<b>No jobs were found.</b> The AMS site may have changed; check the log.' : '',
    ...s.warnings.map((w) => esc(w)),
    ...s.errors.map((e) => esc(e)),
  ].filter(Boolean);

  const html = `<div style="font-family:Arial,sans-serif;font-size:14px">
    <h2>AMS job bot: ${date}${config.dryRun ? ' (DRY RUN: nothing was sent to employers)' : ''}</h2>
    <p>${s.found} recent jobs found, ${s.newJobs} new.</p>
    ${alerts.length ? `<div style="background:#fff3cd;padding:10px;border-radius:6px">${alerts.map((a) => `<p>${a}</p>`).join('')}</div>` : ''}
    ${config.dryRun ? section('Drafts (sent to you instead of the employer)', s.drafted, 'None.') : section('Applied', s.applied, 'No applications sent today.')}
    ${section('Apply manually (also in external_jobs.xlsx)', s.manual, 'None today.')}
    ${s.queued.length ? section('Queued for the next run (daily limit reached)', s.queued, '') : ''}
    ${s.failed.length ? section('Sending failed (please apply manually)', s.failed, '') : ''}
    ${section('Skipped', s.skipped, 'None.')}
    <p style="color:#777">Log file: ${esc(logFile)}</p></div>`;

  const text = [
    `AMS job bot ${date}${config.dryRun ? ' (DRY RUN)' : ''}`,
    `${s.found} recent jobs found, ${s.newJobs} new.`,
    s.fatal ? `CRASH: ${s.fatal.stack ?? s.fatal.message}` : '',
    ...s.warnings, ...s.errors,
    textSection(config.dryRun ? 'Drafts' : 'Applied', config.dryRun ? s.drafted : s.applied),
    textSection('Apply manually', s.manual),
    s.queued.length ? textSection('Queued', s.queued) : '',
    s.failed.length ? textSection('Sending failed', s.failed) : '',
    textSection('Skipped', s.skipped),
  ].filter(Boolean).join('\n');

  const attachments = existsSync(config.excelPath) ? [{ filename: 'external_jobs.xlsx', path: config.excelPath }] : [];
  await sendMail({ to: config.reportTo, subject, text, html, attachments });
  log.info(`Report sent to ${config.reportTo}`);
}
