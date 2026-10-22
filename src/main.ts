import Anthropic from '@anthropic-ai/sdk';
import { setTimeout as sleep } from 'node:timers/promises';
import { reviewJob, type Review } from './ai.js';
import { AmsClient, jobLink, type SearchJob } from './ams.js';
import { config } from './config.js';
import { writeCoverLetter } from './coverLetter.js';
import { isHandled, jobsByStatus, markError, setStatus, upsertJob, type JobRow } from './db.js';
import { writeExternalJobs } from './excel.js';
import { log, logFile } from './log.js';
import { sendMail, verifyMailer } from './mailer.js';
import { loadProfile, unfilledFields, type Profile } from './profile.js';
import { RunSummary, sendReport } from './report.js';
import { findEmails, findPhones, findUrls, fullDescription, waLink } from './text.js';

/** Titles that are never student jobs; skipped without spending an AI call. */
const TITLE_BLOCKLIST = /lehrling|lehrstelle|\blehre\b|leitung|leiter|manager|\bkoch|köchin|fahrer|chauffeur|elektriker|installateur|pflege|meister|techniker|ingenieur/i;

const location = (j: SearchJob) => [j.workingLocation?.zipCode, j.workingLocation?.town].filter(Boolean).join(' ');

function baseRow(j: SearchJob) {
  return { id: j.id, uuid: j.uuid, title: j.title, company: j.company?.name ?? '?', link: jobLink(j.uuid), location: location(j), posted_at: j.lastUpdatedAt.slice(0, 10) };
}

async function fetchOnly(ams: AmsClient) {
  const jobs = await ams.searchAll();
  const fresh = jobs.filter((j) => !isHandled(j.id));
  log.info(`${jobs.length} recent jobs, ${fresh.length} not yet handled:`);
  for (const j of jobs) console.log(`${isHandled(j.id) ? '  ' : '* '}${j.lastUpdatedAt.slice(0, 10)}  ${j.id}  ${j.title} · ${j.company?.name} · ${location(j)}\n    ${jobLink(j.uuid)}`);
  log.info('Sample details (first 5 new jobs):');
  for (const j of fresh.slice(0, 5)) {
    const text = fullDescription(await ams.detail(j.uuid));
    console.log(`\n--- ${j.title} · ${j.company?.name}\n  emails: ${findEmails(text).join(', ') || '-'}\n  phones: ${findPhones(text).join(', ') || '-'}\n  links:  ${findUrls(text).join(', ') || '-'}`);
  }
}

/** Decide the next status for a reviewed job and record it. */
function classify(j: SearchJob, review: Review, description: string, profile: Profile, s: RunSummary) {
  const row = baseRow(j);
  const item = { title: row.title, company: row.company, link: row.link };
  const common = { ...row, decision: review.suitable ? 'suitable' as const : 'unsuitable' as const, apply_method: review.apply_method, review_json: JSON.stringify(review) };

  if (!review.suitable) {
    upsertJob({ ...common, status: 'skipped', reason: review.reason });
    s.skipped.push({ ...item, note: review.reason });
    return;
  }

  // Auto-apply only when the listing itself says to apply by email and the address really occurs in it.
  const email = review.apply_email?.trim().toLowerCase() ?? '';
  const emailInListing = email !== '' && findEmails(description).includes(email);
  if (review.apply_method === 'email' && review.applies_by_email_explicitly && emailInListing) {
    upsertJob({ ...common, status: 'queued', apply_target: email, reason: review.reason });
    return;
  }

  const phone = review.apply_phone ?? findPhones(description)[0] ?? null;
  const url = review.apply_url ?? j.urlToJobOffer ?? null;
  const target = review.apply_method === 'phone' ? phone : review.apply_method === 'external' ? url : (url ?? phone ?? (email || null));
  const wa = phone && (review.apply_method === 'phone' || !url) ? waLink(phone, j.title, profile.name) : null;
  const note = review.apply_method === 'email' && !emailInListing
    ? `${review.reason} (Email application, but the address could not be verified in the listing; check it manually.)`
    : review.reason;
  upsertJob({ ...common, status: 'manual', apply_target: target ?? row.link, wa_link: wa, reason: note });
  s.manual.push({ ...item, target: target ?? undefined, note: `${review.apply_method}: ${note}${wa ? ` · WhatsApp: ${wa}` : ''}` });
}

function signature(p: Profile): string {
  return ['', 'Mit freundlichen Grüßen', p.name, p.phone.startsWith('[') ? '' : `Tel.: ${p.phone}`, `E-Mail: ${p.email}`].filter((l, i) => i === 0 || l).join('\n');
}

async function sendApplications(profile: Profile, s: RunSummary) {
  const queued = jobsByStatus('queued');
  if (!queued.length) return;
  const missing = unfilledFields(profile);
  if (!config.dryRun && missing.length) {
    s.warnings.push(`Applications NOT sent: fill in ${missing.join(', ')} in config/profile.json first. ${queued.length} job(s) stay queued.`);
    s.queued.push(...queued.map((r) => ({ title: r.title, company: r.company, link: r.link, target: r.apply_target ?? undefined })));
    return;
  }
  if (missing.length) s.warnings.push(`Profile placeholders still unfilled (${missing.join(', ')}); drafts will contain them.`);

  const batch = queued.slice(0, config.maxApplicationsPerRun);
  for (const [i, row] of batch.entries()) {
    if (i > 0) await sleep(config.sendDelaySeconds * 1000);
    await sendOne(row, profile, s);
  }
  for (const r of queued.slice(batch.length)) s.queued.push({ title: r.title, company: r.company, link: r.link, target: r.apply_target ?? undefined, note: 'Daily limit reached; will be sent next run.' });
}

async function sendOne(row: JobRow, profile: Profile, s: RunSummary) {
  const review = JSON.parse(row.review_json!) as Review;
  const employer = row.apply_target!;
  const item = { title: row.title, company: row.company, link: row.link, target: employer };
  try {
    const fileName = profile.name.trim().replace(/[^p{L}p{N}]+/gu, '_');
    const attachments = [{ filename: `Lebenslauf_${fileName}.pdf`, path: config.cvPath }];
    if (review.cover_letter_required && review.cover_letter) {
      const pdf = await writeCoverLetter({ profile, company: row.company, title: row.title, reference: review.reference_number, body: review.cover_letter, jobId: row.id });
      attachments.push({ filename: `Anschreiben_${fileName}.pdf`, path: pdf });
    }
    const body = review.application_email.body.trim() + '\n' + signature(profile);
    let subject = review.application_email.subject.trim();
    if (review.reference_number && !subject.includes(review.reference_number)) subject += ` (Ref.-Nr. ${review.reference_number})`;
    const docsNote = review.required_documents.length ? `Requested documents: ${review.required_documents.join(', ')}` : '';

    if (config.dryRun) {
      await sendMail({
        to: config.reportTo,
        fromName: profile.name,
        subject: `[ENTWURF → ${employer}] ${subject}`,
        text: `=== DRAFT (DRY RUN): NOT sent to the employer ===\nWould go to: ${employer}\nJob: ${row.title} · ${row.company}\n${row.link}\n${docsNote}\nAttachments: ${attachments.map((a) => a.filename).join(', ')}\n==================================================\n\n${body}`,
        attachments,
      });
      setStatus(row.id, 'drafted', { sent_to: config.reportTo });
      s.drafted.push({ ...item, note: docsNote || undefined });
    } else {
      await sendMail({ to: employer, fromName: profile.name, subject, text: body, attachments });
      setStatus(row.id, 'applied', { sent_to: employer });
      s.applied.push({ ...item, note: docsNote || undefined });
    }
    log.info(`${config.dryRun ? 'Draft' : 'Application'} sent: ${row.title} · ${row.company} → ${config.dryRun ? config.reportTo : employer}`);
  } catch (e) {
    setStatus(row.id, 'failed', { reason: `Send failed: ${(e as Error).message}` });
    s.failed.push({ ...item, note: (e as Error).message });
    log.error(`Sending failed for ${row.id}:`, e);
  }
}

async function run(s: RunSummary) {
  const profile = loadProfile();
  // Send already-queued applications only: no AMS search, no AI calls.
  if (config.sendOnly) {
    await verifyMailer();
    await sendApplications(profile, s);
    return await writeExternalJobs();
  }
  const ams = new AmsClient();
  try {
    await ams.open();
    if (config.fetchOnly) return await fetchOnly(ams);

    if (!config.anthropicApiKey) throw new Error('ANTHROPIC_API_KEY is not set in .env');
    await verifyMailer();

    const jobs = await ams.searchAll();
    s.found = jobs.length;
    const fresh = jobs.filter((j) => !isHandled(j.id)).sort((a, b) => b.lastUpdatedAt.localeCompare(a.lastUpdatedAt));
    const todo = fresh.slice(0, config.maxNewJobsPerRun);
    s.newJobs = fresh.length;
    if (fresh.length > todo.length) s.warnings.push(`${fresh.length - todo.length} new jobs left for the next run (MAX_NEW_JOBS_PER_RUN=${config.maxNewJobsPerRun}).`);
    log.info(`${jobs.length} recent jobs, ${fresh.length} new; reviewing ${todo.length}`);

    // Details are fetched one by one (single browser page); AI reviews run in parallel meanwhile.
    const inFlight = new Set<Promise<void>>();
    let fatal: Error | null = null;
    let done = 0;
    const fail = (j: SearchJob, e: unknown) => {
      if (e instanceof Anthropic.AuthenticationError || e instanceof Anthropic.PermissionDeniedError) { fatal = e; return; }
      markError(baseRow(j), (e as Error).message);
      s.errors.push(`${j.title} · ${j.company?.name}: ${(e as Error).message} (will retry next run)`);
      log.error(`Job ${j.id} failed:`, e);
    };

    for (const j of todo) {
      if (fatal) break;
      const row = baseRow(j);
      if (TITLE_BLOCKLIST.test(j.title)) {
        const reason = 'Title indicates a skilled, leadership, driving or apprenticeship role.';
        upsertJob({ ...row, status: 'skipped', decision: 'unsuitable', reason });
        s.skipped.push({ title: row.title, company: row.company, link: row.link, note: reason });
        done++;
        continue;
      }
      let description: string;
      try {
        description = fullDescription(await ams.detail(j.uuid));
      } catch (e) {
        fail(j, e);
        continue;
      }
      const task = reviewJob(profile, description)
        .then((review) => {
          classify(j, review, description, profile, s);
          log.info(`[${++done}/${todo.length}] ${review.suitable ? 'SUITABLE' : 'skip    '} [${review.apply_method}] ${j.title} · ${row.company}: ${review.reason}`);
        })
        .catch((e) => fail(j, e))
        .finally(() => inFlight.delete(task));
      inFlight.add(task);
      if (inFlight.size >= config.reviewConcurrency) await Promise.race(inFlight);
    }
    await Promise.all(inFlight);
    if (fatal) throw fatal;
  } finally {
    await ams.close();
  }

  await sendApplications(profile, s);
  await writeExternalJobs();
}

async function main() {
  log.info(`ams-bot start: ${config.fetchOnly ? 'fetch-only' : config.sendOnly ? `send-only (${config.dryRun ? 'DRY' : 'LIVE'})` : config.dryRun ? 'DRY RUN' : 'LIVE'}, db=${config.dbPath}, log=${logFile}`);
  const s = new RunSummary();
  try {
    await run(s);
  } catch (e) {
    s.fatal = e as Error;
    log.error('Run failed:', e);
  }
  if (config.fetchOnly) return process.exit(s.fatal ? 1 : 0);
  try {
    await sendReport(s);
  } catch (e) {
    log.error('Could not send the daily report:', e);
    process.exitCode = 1;
  }
  log.info(`Done. applied=${s.applied.length} drafts=${s.drafted.length} manual=${s.manual.length} skipped=${s.skipped.length} errors=${s.errors.length}`);
  if (s.fatal) process.exitCode = 1;
}

await main();
