import dotenv from 'dotenv';
dotenv.config({ override: true });
import { chromium } from 'playwright';
import readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { config } from '../src/config.js';
import { getHermesAccount } from '../src/store.js';

const chatId = process.argv[2] || '1182254896';
const account = await getHermesAccount({ secret: config.botSecretKey, chatId });
if (!account?.hermesUsername || !account?.hermesPassword) throw new Error('Missing Hermes account');

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
  if (ct.includes('json')) body = await response.text().catch(() => '');
  api.push({ status: response.status(), method: response.request().method(), url, requestBody: response.request().postData() || '', body: body.slice(0, 4000) });
});

async function typeInto(locator, value) {
  await locator.waitFor({ state: 'visible' });
  await locator.click();
  await locator.fill('');
  await locator.pressSequentially(value, { delay: 30 });
}

async function submitOtp(otp) {
  const inputs = await page.locator('input[type="tel"], input[inputmode="numeric"], input[type="number"]').all();
  if (!inputs.length) throw new Error('No OTP inputs');
  if (inputs.length >= 4) {
    for (let i = 0; i < Math.min(inputs.length, otp.length); i += 1) {
      await inputs[i].click();
      await inputs[i].fill('');
      await page.keyboard.type(otp[i], { delay: 80 });
    }
  } else {
    await inputs[0].click();
    await inputs[0].fill('');
    await page.keyboard.type(otp, { delay: 80 });
  }
  await page.waitForTimeout(800);
  console.log('OTP_VALUES', await page.locator('input[type="tel"], input[inputmode="numeric"], input[type="number"]').evaluateAll(xs => xs.map(x => x.value).join('')));
  const enabledVerify = page.locator("button:has-text('Xác thực'):not([disabled]), button:has-text('Xac thuc'):not([disabled]), button:has-text('Verify'):not([disabled])").first();
  if (await enabledVerify.isVisible().catch(() => false)) await enabledVerify.click();
  else await page.locator("button:has-text('Xác thực'), button:has-text('Xac thuc'), button:has-text('Verify'), button[type='submit']").first().click();
  await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(4000);
}

try {
  await page.goto(config.hermesLoginUrl, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1500);
  await typeInto(page.locator("input[formcontrolname='username'], input[type='email'], input[formcontrolname='email'], input[placeholder*='Email' i], input[type='text']").first(), account.hermesUsername);
  await typeInto(page.locator("input[type='password']").first(), account.hermesPassword);
  await page.locator("button[type='submit']:has-text('Đăng nhập'), button[type='submit'], button:has-text('Login')").first().click();
  await page.waitForTimeout(5000);

  const body = await page.locator('body').innerText().catch(() => '');
  console.log('OTP_READY');
  console.log(body.match(/Mã OTP[^\n]+|Mã kích hoạt[^\n]+|Gửi lại mã[^\n]+/g)?.join('\n') || body.slice(0, 500));

  const rl = readline.createInterface({ input, output });
  const otp = (await rl.question('OTP> ')).trim().replace(/\s+/g, '');
  rl.close();
  if (!/^\d{4,8}$/.test(otp)) throw new Error('Invalid OTP');
  await submitOtp(otp);

  const bodyAfterOtp = await page.locator('body').innerText().catch(() => '');
  const lastLoginOtp = api.filter(x => /login-via-otp/i.test(x.url)).at(-1);
  if (/Mã OTP|Bạn không nhận được mã|Gửi lại mã|Xác thực/i.test(bodyAfterOtp) && await page.locator('input[type="tel"], input[inputmode="numeric"], input[type="number"]').first().isVisible().catch(() => false)) {
    console.log('OTP_FAILED');
    console.log(lastLoginOtp?.body || bodyAfterOtp.slice(0, 1200));
    process.exitCode = 4;
  } else {
    await page.goto(new URL('/support-working-schedule', config.hermesLoginUrl).toString(), { waitUntil: 'domcontentloaded' }).catch(e => console.log('GOTO_SUPPORT_SCHEDULE_ERR', e.message));
    await page.waitForTimeout(8000);
    await page.screenshot({ path: 'artifacts/hermes-work-schedule.png', fullPage: true }).catch(() => {});
    console.log('URL', page.url());
    console.log('TITLE', await page.title().catch(() => ''));
    console.log('BODY', (await page.locator('body').innerText().catch(() => '')).slice(0, 8000));
    console.log('API', JSON.stringify(api.slice(-150), null, 2));
  }
} finally {
  await browser.close().catch(() => {});
}
