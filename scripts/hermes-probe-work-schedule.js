import dotenv from 'dotenv';
dotenv.config({ override: true });
import { chromium } from 'playwright';
import { config } from '../src/config.js';
import { getHermesAccount } from '../src/store.js';

const chatId = process.argv[2] || '1182254896';
const account = await getHermesAccount({ secret: config.botSecretKey, chatId });
if (!account?.hermesUsername || !account?.hermesPassword) {
  throw new Error('Missing Hermes account');
}

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ ignoreHTTPSErrors: true, locale: config.locale, timezoneId: config.timezoneId, viewport: { width: 1365, height: 900 } });
const page = await context.newPage();
page.setDefaultTimeout(config.timeoutMs);
const api = [];
page.on('response', async (response) => {
  const url = response.url();
  if (!url.includes('/api/')) return;
  let body = '';
  const ct = response.headers()['content-type'] || '';
  if (ct.includes('json')) {
    body = await response.text().catch(() => '');
  }
  api.push({ status: response.status(), method: response.request().method(), url, body: body.slice(0, 2000) });
});

async function fill(selector, value) {
  const loc = page.locator(selector).first();
  await loc.waitFor({ state: 'visible' });
  await loc.click();
  await loc.fill('');
  await loc.pressSequentially(value, { delay: 20 });
}

await page.goto(config.hermesLoginUrl, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(2000);
if (await page.locator("input[type='password']").first().isVisible().catch(() => false)) {
  await fill("input[formcontrolname='username'], input[type='email'], input[formcontrolname='email'], input[placeholder*='Email' i], input[type='text']", account.hermesUsername);
  await fill("input[type='password']", account.hermesPassword);
  await page.locator("button[type='submit']").first().click();
  await page.waitForTimeout(6000);
}
const bodyAfterLogin = await page.locator('body').innerText().catch(() => '');
if (/OTP|mã xác thực|xac thuc|verification/i.test(bodyAfterLogin)) {
  console.log('OTP_REQUIRED');
  await page.screenshot({ path: 'artifacts/hermes-probe-otp.png', fullPage: true }).catch(() => {});
  await browser.close();
  process.exit(3);
}
await page.goto(new URL('/saleman-working-schedule', config.hermesLoginUrl).toString(), { waitUntil: 'domcontentloaded' }).catch(e => console.log('GOTO_SCHEDULE_ERR', e.message));
await page.waitForTimeout(8000);
await page.screenshot({ path: 'artifacts/hermes-after-login.png', fullPage: true }).catch(() => {});
console.log('URL', page.url());
console.log('TITLE', await page.title().catch(() => ''));
console.log('BODY', (await page.locator('body').innerText().catch(() => '')).slice(0, 4000));
console.log('API', JSON.stringify(api.slice(-80), null, 2));
await browser.close();
