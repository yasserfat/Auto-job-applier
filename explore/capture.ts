// Exploration script: open a jobs.ams.at search, click the first result(s), record every JSON response.
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';

const OUT = process.argv[3] ?? 'explore/out2';
mkdirSync(OUT, { recursive: true });

const url = process.argv[2] ??
  'https://jobs.ams.at/public/emps/jobs?query=K%C3%BCchenhilfe&location=Salzburg&vicinity=25&PERIOD=LAST_MONTH&WORKING_TIME=T&page=1&sortField=PERIOD';

const browser = await chromium.launch();
const page = await browser.newPage({ locale: 'de-AT' });
let n = 0;
const index: any[] = [];

page.on('response', async (res) => {
  const ct = res.headers()['content-type'] ?? '';
  if (!ct.includes('json') || !res.url().includes('/api/')) return;
  try {
    const body = await res.json();
    const file = `${OUT}/${String(++n).padStart(2, '0')}.json`;
    writeFileSync(file, JSON.stringify(body, null, 2));
    index.push({ file, status: res.status(), url: res.url() });
    console.log(res.status(), res.request().method(), res.url(), '->', file);
  } catch {}
});

await page.goto(url, { waitUntil: 'networkidle', timeout: 60000 });
// Open the first three job results to capture the detail endpoint.
const links = page.locator('a[href*="/jobs/"]');
console.log('result links:', await links.count());
const hrefs = (await links.evaluateAll((as) => as.map((a) => (a as HTMLAnchorElement).href))).filter((h) => /\/jobs\/\d+/.test(h));
for (const h of [...new Set(hrefs)].slice(0, 3)) {
  console.log('open', h);
  await page.goto(h, { waitUntil: 'networkidle', timeout: 60000 });
  await page.waitForTimeout(1500);
}
writeFileSync(`${OUT}/index.json`, JSON.stringify(index, null, 2));
await browser.close();
