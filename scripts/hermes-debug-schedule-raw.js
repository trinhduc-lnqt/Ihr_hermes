import dotenv from 'dotenv';
dotenv.config({ override: true });
import { chromium } from 'playwright';
import { config } from '../src/config.js';
import { getHermesAccount } from '../src/store.js';

const chatId = process.argv[2] || '1182254896';
const dates = process.argv.slice(3);
const targetDates = dates.length ? dates : ['2026-04-27', '2026-04-28', '2026-04-29'];
const account = await getHermesAccount({ secret: config.botSecretKey, chatId });
if (!account?.hermesUsername || !account?.hermesPassword) throw new Error('Missing Hermes account');

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ ignoreHTTPSErrors: true, locale: config.locale, timezoneId: config.timezoneId, viewport: { width: 1365, height: 900 }, ...(account.hermesSession ? { storageState: account.hermesSession } : {}) });
const page = await context.newPage();
page.setDefaultTimeout(config.timeoutMs);

function addDays(date, days) { const next = new Date(date); next.setUTCDate(next.getUTCDate() + days); return next; }
function weekRange(iso) { const d = new Date(`${iso}T00:00:00+07:00`); const day = d.getUTCDay() || 7; const start = addDays(d, 1 - day); const end = addDays(start, 6); return { start, end }; }
function ymd(date) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: config.timezoneId, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}
function buildUrl(iso, oneDay = false) {
  const base = config.hermesBaseUrl || new URL(config.hermesLoginUrl).origin;
  const { start, end } = oneDay ? { start: new Date(`${iso}T00:00:00+07:00`), end: new Date(`${iso}T00:00:00+07:00`) } : weekRange(iso);
  const params = new URLSearchParams({
    startTime: `${ymd(start)} 00:00:00`,
    endTime: `${ymd(end)} 23:59:59`,
    deptCode: 'HAN_SUPPORT',
    teamId: '5fe9bcb15885324fa7a01a02',
    page: '0'
  });
  return `${base}/api/support-online/working-schedule/list?${params}`;
}
function summarize(value, target) {
  const out = [];
  const walk = (v, path = '') => {
    if (!v || typeof v !== 'object') return;
    if (Array.isArray(v)) {
      if (v.length && v.some(x => JSON.stringify(x).includes('duc.dao') || JSON.stringify(x).includes(target) || /#\d+|Lịch trực|FABI|CRM/.test(JSON.stringify(x)))) {
        out.push({ path, type: 'array', length: v.length, sample: v.slice(0, 3) });
      }
      v.forEach((x, i) => walk(x, `${path}[${i}]`));
      return;
    }
    const txt = JSON.stringify(v);
    if (txt.includes(target) || txt.includes('duc.dao') || /#\d+|Lịch trực|FABI|CRM/.test(txt)) {
      out.push({ path, keys: Object.keys(v), sample: v });
    }
    for (const [k, child] of Object.entries(v)) walk(child, path ? `${path}.${k}` : k);
  };
  walk(value);
  return out.slice(0, 80);
}

await page.goto(new URL('/support-working-schedule', config.hermesLoginUrl).toString(), { waitUntil: 'domcontentloaded' }).catch(() => {});
await page.waitForTimeout(3000);
const body = await page.locator('body').innerText().catch(() => '');
if (/OTP|mã xác thực|dang nhap|đăng nhập|password/i.test(body)) {
  console.log('SESSION_NOT_READY_OR_OTP');
  console.log(body.slice(0, 1000));
  await browser.close();
  process.exit(3);
}

for (const iso of targetDates) {
  for (const oneDay of [true, false]) {
    const url = buildUrl(iso, oneDay);
    const fetched = await page.evaluate(async (url) => {
      const r = await fetch(url, { credentials: 'include' });
      return { status: r.status, text: await r.text() };
    }, url);
    let json = null;
    try { json = JSON.parse(fetched.text); } catch {}
    console.log('\n===== DATE', iso, oneDay ? 'DAY' : 'WEEK', fetched.status, '=====');
    console.log('URL', url);
    console.log('TEXT_HEAD', fetched.text.slice(0, 1200));
    if (json) console.log('SUMMARY', JSON.stringify(summarize(json, iso), null, 2).slice(0, 12000));
  }
}
await browser.close();
