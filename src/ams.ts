// jobs.ams.at signs its API requests in the browser (x-ams-access-token*), so we drive the
// real site with Playwright and read the JSON responses the page itself requests.
import { chromium, type Browser, type Page } from 'playwright';
import { config } from './config.js';
import { log } from './log.js';

const BASE = 'https://jobs.ams.at/public/emps';

/** Searches covering student-suitable work. Results are merged and de-duplicated by job ID. */
export const SEARCH_TERMS = [
  // The query is a literal text match, so short common words find far more than compounds.
  'Reinigung',
  'Reinigungskraft',
  'Küchenhilfe',
  'Küche',
  'Abwasch',
  'Abwäscher',
  'Housekeeping',
  'Zimmermädchen',
  'Stubenmädchen',
  'Frühstück',
  'Hotel',
  'Service',
  'Büro',
  'Lager',
  'Kommissionierer',
  'Regalbetreuung',
  'Verkauf',
  'Kassa',
  'geringfügig',
  'Aushilfe',
  'Student',
];

export type SearchJob = {
  id: number;
  uuid: string;
  lastUpdatedAt: string;
  title: string;
  company: { name: string };
  workingTime?: { code: string; description: string };
  workingLocation?: { zipCode?: string; town?: string; municipality?: string };
  urlToJobOffer: string | null;
  jobPortalName: string | null;
};

export type JobDetail = SearchJob & {
  summary: string | null;
  companyIntroduction?: string | null;
  generalEqualitiyInfo?: string | null;
  availableFrom?: string | null;
  contact?: { firstName?: string | null; lastName?: string | null; email?: string | null; phoneNumbers?: unknown[] };
  drivingLicence?: unknown;
  qualifications?: unknown[];
  educationLevels?: { description: string }[];
  occupationExperience?: unknown[];
};

type SearchResponse = { totalResults: number; totalPages: number; page: number; results: SearchJob[] };

export const jobLink = (uuid: string) => `${BASE}/jobs/${uuid}`;

async function resolveLocationId(): Promise<string> {
  try {
    const res = await fetch(`${BASE}/api/open/suggestions/location?text=Salzburg`);
    const list = (await res.json()) as { locationId: string; text: string; type: string }[];
    const hit = list.find((l) => l.type === 'TOWN' && l.text === 'Salzburg');
    if (hit) return hit.locationId;
  } catch (e) {
    log.warn('Location lookup failed, using known Salzburg ID', e);
  }
  return 'TOWN_13582';
}

export class AmsClient {
  private browser?: Browser;
  private page?: Page;

  async open() {
    this.browser = await chromium.launch();
    const ctx = await this.browser.newContext({ locale: 'de-AT' });
    this.page = await ctx.newPage();
  }

  async close() {
    await this.browser?.close();
  }

  /** Navigate to `url` and return the first JSON response whose URL contains `apiPart`. */
  private async capture<T>(url: string, apiPart: string): Promise<T> {
    const page = this.page!;
    const [res] = await Promise.all([
      page.waitForResponse((r) => r.url().includes(apiPart) && r.request().method() === 'GET', { timeout: 45000 }),
      page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 }),
    ]);
    if (!res.ok()) throw new Error(`${apiPart} returned HTTP ${res.status()}: ${(await res.text()).slice(0, 200)}`);
    return (await res.json()) as T;
  }

  /** All jobs from the last `maxAgeDays` within `radiusKm` of Salzburg, over all search terms. */
  async searchAll(): Promise<SearchJob[]> {
    const locationId = await resolveLocationId();
    const cutoff = Date.now() - config.maxAgeDays * 86400_000;
    const byId = new Map<number, SearchJob>();
    let failures = 0;

    for (const term of SEARCH_TERMS) {
      let found = 0;
      for (let pageNo = 1; pageNo <= config.maxPagesPerQuery; pageNo++) {
        const params = new URLSearchParams({
          query: term, location: 'Salzburg', locationId, vicinity: String(config.radiusKm),
          PERIOD: 'LAST_MONTH', WORKING_TIME: 'T', sortField: 'PERIOD', page: String(pageNo),
        });
        let data: SearchResponse;
        try {
          data = await this.capture<SearchResponse>(`${BASE}/jobs?${params}`, '/api/search?');
        } catch (e) {
          failures++;
          log.warn(`Search "${term}" page ${pageNo} failed:`, (e as Error).message);
          break;
        }
        const fresh = data.results.filter((j) => Date.parse(j.lastUpdatedAt) >= cutoff);
        for (const j of fresh) byId.set(j.id, j);
        found += fresh.length;
        // Sorted newest first: once a page contains older jobs, later pages only hold older ones.
        if (fresh.length < data.results.length || pageNo >= data.totalPages) break;
      }
      log.info(`Search "${term}": ${found} recent jobs`);
    }
    if (failures === SEARCH_TERMS.length) throw new Error('Every AMS search failed. The site may have changed or be down.');
    return [...byId.values()];
  }

  async detail(uuid: string): Promise<JobDetail> {
    return this.capture<JobDetail>(jobLink(uuid), `/api/joboffer/uuid/${uuid}`);
  }
}
