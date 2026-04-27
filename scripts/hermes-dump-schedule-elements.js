import dotenv from 'dotenv';
dotenv.config({ override: true });
import { chromium } from 'playwright';
import { config } from '../src/config.js';
import { getHermesAccount } from '../src/store.js';
const account = await getHermesAccount({ secret: config.botSecretKey, chatId: process.argv[2] || '1182254896' });
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ ignoreHTTPSErrors: true, locale: config.locale, timezoneId: config.timezoneId, viewport: { width: 1365, height: 900 }, storageState: account.hermesSession });
const page = await context.newPage();
await page.goto(new URL('/support-working-schedule', config.hermesLoginUrl).toString(), { waitUntil: 'domcontentloaded' }).catch(() => {});
await page.waitForTimeout(8000);
const data = await page.evaluate(() => {
 const clean=s=>String(s||'').replace(/\s+/g,' ').trim();
 const arr=[];
 const all=[...document.querySelectorAll('body *')];
 for (const el of all) {
  const t=clean(el.innerText);
  if (!t || t.length>1000) continue;
  if (/duc\.dao|#1795799|#1795620|#1789570|T2, 2026-04-27|T3, 2026-04-28|Lịch trực/.test(t)) {
   const r=el.getBoundingClientRect();
   arr.push({tag:el.tagName, cls:String(el.className||''), id:el.id||'', text:t, rect:{x:Math.round(r.x),y:Math.round(r.y),w:Math.round(r.width),h:Math.round(r.height)}, children:el.children.length, html:el.outerHTML.slice(0,1000)});
  }
 }
 return arr.slice(-200);
});
console.log(JSON.stringify(data,null,2));
await browser.close();
