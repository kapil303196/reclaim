// Fails if any page is wider than the phone it is being read on.
//
// A horizontal scrollbar on a marketing site is the kind of defect that is
// obvious to every visitor and invisible to whoever built it on a laptop, so it
// is worth a machine noticing instead. Pages are discovered from disk rather
// than listed, so a new page is covered the day it is added.
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.argv[2] || 'site';
const BASE = `http://127.0.0.1:${process.env.PORT || 8099}`;

// 320 is the narrowest phone still in use; 390 is an iPhone; 768 is a portrait
// tablet, where a layout that only has a desktop and a phone case tends to break.
const WIDTHS = [320, 360, 390, 414, 768];

/** Every .html under site/, as the clean URL it is served at. */
function pages(dir, prefix = '') {
  const found = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'api' || entry.name.startsWith('.')) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) { found.push(...pages(full, `${prefix}/${entry.name}`)); continue; }
    if (!entry.name.endsWith('.html')) continue;
    found.push(entry.name === 'index.html' ? `${prefix}/` : `${prefix}/${entry.name.slice(0, -5)}`);
  }
  return found;
}

const urls = pages(ROOT).sort();
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || undefined,
});

const failures = [];
for (const width of WIDTHS) {
  const ctx = await browser.newContext({ viewport: { width, height: 844 } });
  // Nothing off this machine. Analytics and a font CDN have no bearing on
  // whether a layout fits a phone, and a check that fails when a third party is
  // slow is a check nobody will trust the next time it goes red.
  await ctx.route('**/*', (route) => {
    const target = new URL(route.request().url());
    if (target.hostname === '127.0.0.1' || target.hostname === 'localhost') return route.continue();
    return route.abort();
  });
  for (const url of urls) {
    const page = await ctx.newPage();
    try {
      await page.goto(BASE + url, { waitUntil: 'load', timeout: 20000 });
    } catch (err) {
      failures.push({ width, url, overflow: 0, note: `could not load: ${err.message}`, culprits: [] });
      await page.close();
      continue;
    }

    const result = await page.evaluate(() => {
      const docW = document.documentElement.clientWidth;
      const scrollW = Math.max(document.documentElement.scrollWidth, document.body.scrollWidth);
      const culprits = [];
      for (const el of document.querySelectorAll('body *')) {
        const r = el.getBoundingClientRect();
        if (r.width === 0 && r.height === 0) continue;
        if (getComputedStyle(el).position === 'fixed') continue;
        // Something inside a box that scrolls sideways on purpose is that box
        // doing its job, not an overflow.
        let contained = false;
        for (let p = el.parentElement; p; p = p.parentElement) {
          const ox = getComputedStyle(p).overflowX;
          if (ox === 'auto' || ox === 'scroll' || ox === 'hidden') { contained = true; break; }
        }
        if (contained) continue;
        if (r.right > docW + 1 || r.width > docW + 1) {
          culprits.push({
            tag: el.tagName.toLowerCase(),
            cls: typeof el.className === 'string' ? el.className.trim().split(/\s+/).join('.') : '',
            id: el.id, right: Math.round(r.right), width: Math.round(r.width),
            text: (el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 48),
          });
        }
      }
      culprits.sort((a, b) => b.right - a.right);
      return { docW, scrollW, culprits: culprits.slice(0, 5) };
    });

    const overflow = result.scrollW - result.docW;
    if (overflow > 1) failures.push({ width, url, overflow, culprits: result.culprits });
    await page.close();
  }
  await ctx.close();
}
await browser.close();

const checked = urls.length * WIDTHS.length;
if (!failures.length) {
  console.log(`${checked} checks passed — ${urls.length} pages at ${WIDTHS.join(', ')}px, none scrolls sideways.`);
  process.exit(0);
}

for (const f of failures) {
  console.error(`\n✗ ${f.url} at ${f.width}px — ${f.note || `${f.overflow}px wider than the screen`}`);
  for (const c of f.culprits) {
    console.error(`    <${c.tag}${c.id ? '#' + c.id : ''}${c.cls ? '.' + c.cls : ''}>` +
      ` width=${c.width} right-edge=${c.right}  ${JSON.stringify(c.text)}`);
  }
}
console.error(`\n${failures.length} of ${checked} checks failed.`);
process.exit(1);
