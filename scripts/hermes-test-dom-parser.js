import dotenv from 'dotenv';
dotenv.config({ override: true });
import { chromium } from 'playwright';
import { config } from '../src/config.js';
import { getHermesAccount } from '../src/store.js';
const account = await getHermesAccount({ secret: config.botSecretKey, chatId: process.argv[2] || '1182254896' });
const dates = process.argv.slice(3).length ? process.argv.slice(3) : ['2026-04-27','2026-04-28','2026-04-29','2026-04-30','2026-05-01','2026-05-02','2026-05-03'];
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ ignoreHTTPSErrors: true, locale: config.locale, timezoneId: config.timezoneId, viewport: { width: 1365, height: 900 }, storageState: account.hermesSession });
const page = await context.newPage();
await page.goto(new URL('/support-working-schedule', config.hermesLoginUrl).toString(), { waitUntil: 'domcontentloaded' }).catch(() => {});
await page.waitForTimeout(8000);
for (const target of dates) {
 const rawItems = await page.evaluate((target) => {
  const clean = (value) => String(value || '').replace(/\s+/g, ' ').trim();
  const headers = [...document.querySelectorAll('.header-wrapper .date-in-week')].map((element) => {
   const rect = element.getBoundingClientRect();
   const text = clean(element.innerText);
   const date = text.match(/\d{4}-\d{2}-\d{2}/)?.[0] || '';
   return { date, left: rect.left, right: rect.right, width: rect.width };
  }).filter((item) => item.date);
  const targetHeader = headers.find((item) => item.date === target);
  const row = [...document.querySelectorAll('.employee-wrapper')].find((element) => /(^|\s)duc\.dao(\s|$)/i.test(clean(element.querySelector('.emp-info')?.innerText || element.innerText)));
  if (!targetHeader || !row) return [];
  const dayWidth = targetHeader.width || (targetHeader.right - targetHeader.left) || 1;
  return [...row.querySelectorAll('.grid-stack-item')].map((element) => {
   const rect = element.getBoundingClientRect();
   const overlap = Math.max(0, Math.min(rect.right, targetHeader.right) - Math.max(rect.left, targetHeader.left));
   return { text: clean(element.innerText), className: String(element.className || ''), left: Math.round(rect.left), right: Math.round(rect.right), overlap: Math.round(overlap) };
  }).filter((item) => item.text && item.overlap >= Math.min(20, dayWidth * 0.2));
 }, target);
 console.log('\nDATE', target, 'COUNT', rawItems.length);
 for (const item of rawItems) console.log('-', item.text, `[${item.className.match(/type-[^\s]+/)?.[0] || ''}]`, `x=${item.left}-${item.right} overlap=${item.overlap}`);
}
await browser.close();
