import dotenv from 'dotenv';
dotenv.config({ override: true });
import { chromium } from 'playwright';
import { config } from '../src/config.js';
import { getHermesAccount } from '../src/store.js';

const chatId = process.argv[2] || '1182254896';
const account = await getHermesAccount({ secret: config.botSecretKey, chatId });
if (!account?.hermesSession) throw new Error('Missing saved Hermes session');
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ ignoreHTTPSErrors: true, locale: config.locale, timezoneId: config.timezoneId, viewport: { width: 1365, height: 900 }, storageState: account.hermesSession });
const page = await context.newPage();
page.setDefaultTimeout(config.timeoutMs);
await page.goto(new URL('/support-working-schedule', config.hermesLoginUrl).toString(), { waitUntil: 'domcontentloaded' }).catch(() => {});
await page.waitForTimeout(8000);
const data = await page.evaluate(() => {
  const clean = (s) => String(s || '').replace(/\s+\n/g, '\n').replace(/\n\s+/g, '\n').replace(/[ \t]+/g, ' ').trim();
  return {
    url: location.href,
    title: document.title,
    bodyHead: clean(document.body.innerText).slice(0, 3000),
    tables: [...document.querySelectorAll('table')].map((table, ti) => ({
      ti,
      className: table.className,
      text: clean(table.innerText).slice(0, 4000),
      headers: [...table.querySelectorAll('thead th, tr th, .mat-header-cell')].map((el) => clean(el.innerText)),
      rows: [...table.querySelectorAll('tbody tr, tr.mat-row, tr')].slice(0, 30).map((tr, ri) => ({
        ri,
        className: tr.className,
        text: clean(tr.innerText),
        cells: [...tr.querySelectorAll('td, th, .mat-cell, .mat-header-cell')].map((td, ci) => ({ ci, cls: td.className, text: clean(td.innerText), html: td.innerHTML.slice(0, 500) }))
      }))
    })),
    matRows: [...document.querySelectorAll('tr.mat-row, .mat-row')].slice(0, 20).map((row, ri) => ({
      ri,
      text: clean(row.innerText),
      cells: [...row.querySelectorAll('.mat-cell, td')].map((td, ci) => ({ ci, cls: td.className, text: clean(td.innerText) }))
    }))
  };
});
console.log(JSON.stringify(data, null, 2));
await browser.close();
