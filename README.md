# ams-bot

Once a day, ams-bot looks on jobs.ams.at for student-suitable part-time jobs within 25 km of Salzburg (cleaning, kitchen help, dishwashing, housekeeping, office, warehouse, retail). It has Claude review each new listing. When the listing asks for applications by email, it applies by email, and it emails you a morning report.

## How it works

1. **Fetch.** The AMS search API only accepts requests signed by its web app, so a headless Chromium (Playwright) opens the real search pages and reads the JSON they load:
   - `GET /public/emps/api/search?query=…&locationId=TOWN_13582&vicinity=25&workingTime=T&period=LAST_MONTH&sortField=PERIOD&page=N`
   - `GET /public/emps/api/joboffer/uuid/{uuid}` (full listing)

   It runs about 20 search terms (see `SEARCH_TERMS` in `src/ams.ts`) and keeps jobs updated in the last 15 days.
2. **Skip known jobs.** Every handled job ID is stored in SQLite (`jobs.db`) and never processed twice.
3. **Review.** Titles that are obviously out of scope (Lehrling, Leitung, Koch, Fahrer…) are skipped without an AI call. The rest are sent to Claude (`claude-haiku-4-5`) with your profile. Claude returns schema-validated JSON (retried once if invalid) with a suitable/unsuitable verdict, the apply method, the email/link/phone, the reference number, the required documents, and a German application email (plus a cover letter when one is requested).
4. **Apply.** The bot only sends automatically when all of these hold: the job is suitable, the listing explicitly asks for applications by email, **and** the address actually appears in the listing. Your CV (`assets/cv.pdf`) is attached. If the listing requests a cover letter, a PDF is generated and attached too. Limits: at most 15 per run, 30 s apart. Extra jobs stay queued for the next day.
5. **Manual list.** Suitable jobs that need an online form, a phone call or are unclear go into `external_jobs.xlsx` with date, title, company, link or phone, a WhatsApp link with a short German/English message, and why the job fits.
6. **Report.** One email to you with: applied jobs, jobs to apply for manually, skipped jobs and why, and `external_jobs.xlsx` attached. If the run finds 0 jobs or crashes, the report still goes out with the error.

## Setup

Requirements: Node.js 22+ (tested on 24) and Windows.

```powershell
npm install
npx playwright install chromium
```

### 1. Add your CV and profile

Put your CV at `assets/cv.pdf` (or set `CV_PATH` in `.env`).

Copy `config/profile.example.json` to `config/profile.json` and fill it in. Replace every `[...]` placeholder: `availability`, `maxHoursPerWeek`, `phone`, `area`. Write availability the way you'd tell an employer, e.g. `"Mo, Mi, Fr ab 14:00; Sa und So ganztags"`.
`email` can stay empty; it then uses `GMAIL_USER`.

**Live sending is blocked while placeholders remain.** Dry runs still work and warn you about them.

### 2. Fill in `.env`

Copy `.env.example` to `.env`:

| Key | What |
|---|---|
| `ANTHROPIC_API_KEY` | From console.anthropic.com → API keys |
| `GMAIL_USER` | Your Gmail address (sends applications and the report) |
| `GMAIL_APP_PASSWORD` | 16-character Gmail app password (see below) |
| `DRY_RUN` | `true` (default) = drafts go to you only. `false` = real applications |
| `REPORT_TO` | Optional; defaults to `GMAIL_USER` |
| `AI_MODEL` | Optional; default `claude-haiku-4-5` |

Optional tuning: `MAX_APPLICATIONS_PER_RUN` (15), `SEND_DELAY_SECONDS` (30), `MAX_AGE_DAYS` (15), `RADIUS_KM` (25), `MAX_NEW_JOBS_PER_RUN` (500), `REVIEW_CONCURRENCY` (5), `CV_PATH`.

`.env`, `config/profile.json`, `assets/`, `jobs.db`, the logs and the generated files are git-ignored, so your personal data never gets committed. Secrets are masked in the logs.

#### Gmail app password

1. Turn on 2-Step Verification: <https://myaccount.google.com/signinoptions/twosv>
2. Create an app password: <https://myaccount.google.com/apppasswords> (name it "ams-bot").
3. Paste the 16 characters into `GMAIL_APP_PASSWORD` (spaces don't matter).

#### Alternative: Gmail OAuth2 (if app passwords aren't available on your account)

1. In <https://console.cloud.google.com/>, create a project and enable the **Gmail API**.
2. Under **APIs & Services → OAuth consent screen**, choose *External* and add your Gmail as a *test user*.
3. Under **Credentials → Create credentials → OAuth client ID**, choose type *Web application* and add the redirect URI `https://developers.google.com/oauthplayground`. Copy the client ID and secret.
4. Open <https://developers.google.com/oauthplayground>, click ⚙ → *Use your own OAuth credentials*, and paste the ID and secret.
5. Under Step 1, enter the scope `https://mail.google.com/`, click *Authorize APIs* and sign in.
6. Under Step 2, click *Exchange authorization code for tokens* and copy the **refresh token**.
7. Put `GMAIL_OAUTH_CLIENT_ID`, `GMAIL_OAUTH_CLIENT_SECRET` and `GMAIL_OAUTH_REFRESH_TOKEN` in `.env`. When all three are set, they take priority over the app password.

> Refresh tokens for apps in "Testing" status expire after 7 days. Publish the consent screen (no Google review needed for personal use) to keep the token valid.

**Note on antivirus:** Avast/AVG Web/Mail Shield scans HTTPS and SMTP with its own root certificate, which Node.js does not trust. If you see `self-signed certificate in certificate chain`, point Node at the antivirus certificate once and open a new terminal:

```powershell
setx NODE_EXTRA_CA_CERTS "C:ProgramDataAvast SoftwareAvastwscert.pem"
```

## Commands

| Command | What it does |
|---|---|
| `npm run fetch` | Fetch and print jobs only: no AI, no email, no database writes |
| `npm run dry` | Full run in dry-run mode, whatever `.env` says |
| `npm start` | Full run; `DRY_RUN` in `.env` decides drafts vs real |
| `npm run send` | Send already-queued applications only: no AMS search, no AI calls |
| `npm run reset` | Delete the databases (`jobs.db` and `jobs.dry.db`) so all jobs get processed again |
| `npm run schedule` | Register the daily 07:00 Windows task |
| `npm run typecheck` | TypeScript check |

Each run writes `logs/run-<timestamp>.log`.

## Testing in dry-run

1. `npm run fetch`: check that jobs show up.
2. `npm run dry`: every application email comes to **your** inbox with the subject `[ENTWURF → employer@…] Bewerbung als …` and a DRAFT banner showing where it would have gone, with the CV and any cover letter attached. Then the report arrives.
3. Read a few drafts. Adjust `config/profile.json` (or the rules in `src/ai.ts`) if something is off.
4. To re-test the same jobs: `npm run reset -- --dry-only`, then `npm run dry` again.

Dry runs use a separate database (`jobs.dry.db`), so testing never marks jobs as done for live mode.

## Going live

1. Fill in all profile placeholders and check a few drafts.
2. Set `DRY_RUN=false` in `.env`.
3. Run `npm start` once by hand and watch the log, or wait for the scheduled run.

The first run reviews every job from the last 15 days (often 300+, about 10 minutes, roughly $1–3 of API usage). It sends at most 15 applications per run, so the email backlog clears over a few days. Jobs whose sending failed are listed in the report and **not** retried automatically, which avoids double applications.

## Scheduling (Windows)

```powershell
npm run schedule
```

This registers the task **ams-bot**, daily at 07:00, running `scripts/run-daily.cmd`. If the PC was off or asleep at 07:00, the task runs as soon as the PC is back on. It runs as your user while you're logged in.

- **Trigger it now (to test):** `schtasks /run /tn ams-bot`, or Task Scheduler → Task Scheduler Library → *ams-bot* → *Run*
- **Check the last result:** `schtasks /query /tn ams-bot /v /fo list` ("Last Result: 0" = success)
- **Output:** `logs/scheduler.log` (console) and `logs/run-*.log`
- **Change the time:** `powershell -ExecutionPolicy Bypass -File scripts/schedule-windows.ps1 -Time 06:30`
- **Remove:** `npm run schedule -- -Remove`

## Database

`jobs` table: `id` (AMS job ID), `uuid`, `title`, `company`, `location`, `link`, `posted_at`, `apply_method`, `apply_target`, `wa_link`, `decision`, `reason`, `status`, `review_json`, `sent_to`, `attempts`, `created_at`, `updated_at`.

Status values: `applied`, `drafted` (dry run), `queued` (waiting for a free slot), `manual`, `skipped`, `failed` (send error), `error` (fetch/AI error; retried up to 3 times).

## Files

```
src/main.ts         pipeline: fetch → review → classify → send → xlsx → report
src/ams.ts          Playwright fetcher (search terms live here)
src/ai.ts           Claude review prompt + JSON schema
src/text.ts         HTML→text, email/phone/link extraction, wa.me links
src/db.ts           SQLite
src/mailer.ts       Gmail (app password or OAuth2)
src/coverLetter.ts  cover letter PDF
src/excel.ts        external_jobs.xlsx
src/report.ts       daily report
config/profile.json your details used for judging fit and writing applications (from profile.example.json)
explore/capture.ts  the script used to discover the AMS API (re-run if the site changes)
```

## License

MIT
