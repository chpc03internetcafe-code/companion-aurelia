// Lighthouse audit of the website's main pages: `npm run lighthouse` (or `npm run lighthouse -- https://example.com`).
// Audits a production build, so first run `npm run build`, then `npm run preview` (port 4173) with the API running,
// or pass a deployed URL. Needs Chrome installed. HTML reports are saved in lighthouse-reports/.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const base = (process.argv[2] || 'http://localhost:4173').replace(/\/$/, '');
const preset = process.env.LH_PRESET === 'desktop' ? 'desktop' : 'mobile';
const pages = (process.env.LH_PAGES || '/,/companions,/guides,/faq').split(',');
const outDir = path.resolve('lighthouse-reports');
fs.mkdirSync(outDir, { recursive: true });

const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';
const CATEGORIES = ['performance', 'accessibility', 'best-practices', 'seo'];
const rows = [];
let failed = false;

for (const page of pages) {
  const name = page === '/' ? 'home' : page.replace(/^\/|\/$/g, '').replace(/\//g, '-');
  const file = path.join(outDir, `${name}-${preset}`);
  const args = ['--yes', 'lighthouse@12.8.2', base + page, '--quiet', `--only-categories=${CATEGORIES.join(',')}`,
    '--output=json', '--output=html', `--output-path=${file}`, '--chrome-flags=--headless=new --no-first-run'];
  if (preset === 'desktop') args.push('--preset=desktop');
  const r = spawnSync(npx, args, { stdio: ['ignore', 'ignore', 'inherit'], shell: process.platform === 'win32' });
  if (r.status !== 0) { failed = true; console.error(`✗ ${page}: lighthouse exited with ${r.status}`); continue; }
  const report = JSON.parse(fs.readFileSync(`${file}.report.json`, 'utf8'));
  const audits = report.audits;
  rows.push({
    page,
    ...Object.fromEntries(CATEGORIES.map((c) => [c, Math.round((report.categories[c]?.score ?? 0) * 100)])),
    FCP: audits['first-contentful-paint']?.displayValue, LCP: audits['largest-contentful-paint']?.displayValue,
    TBT: audits['total-blocking-time']?.displayValue, CLS: audits['cumulative-layout-shift']?.displayValue,
  });
}

console.log(`\nLighthouse (${preset}) — ${base}`);
console.table(rows);
console.log(`Reports: ${outDir}`);
process.exit(failed ? 1 : 0);
