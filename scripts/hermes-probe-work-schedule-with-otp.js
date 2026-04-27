import dotenv from 'dotenv';
dotenv.config({ override: true });
import { chromium } from 'playwright';
import { config } from '../src/config.js';
import { getHermesAccount } from '../src/store.js';

const chatId = process.argv[2] || '1182254896';
const otp = (process.argv[3] || process.env.HERMES_OTP || '').trim().replace(/\s+/g, '');
if (!/^\d{4,8}$/.test(otp)) throw new Error('Missing/invalid OTP');

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

async function login() {
  await page.goto(config.hermesLoginUrl, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1500);
  if (!(await page.locator("input[type='password']").first().isVisible().catch(() => false))) return;
  await typeInto(page.locator("input[formcontrolname='username'], input[type='email'], input[formcontrolname='email'], input[placeholder*='Email' i], input[type='text']").first(), account.hermesUsername);
  await typeInto(page.locator("input[type='password']").first(), account.hermesPassword);
  await page.locator("button[type='submit']:has-text('Đăng nhập'), button[type='submit'], button:has-text('Login')").first().click();
  await page.waitForTimeout(5000);
}

async function submitOtp() {
  await page.locator('input[type="tel"], input[inputmode="numeric"], input[type="number"]').first().waitFor({ state: 'visible', timeout: 15000 });
  const telInputs = await page.locator('input[type="tel"], input[inputmode="numeric"], input[type="number"]').all();
  if (telInputs.length >= 4) {
    for (let i = 0; i < Math.min(telInputs.length, otp.length); i += 1) {
      await telInputs[i].click();
      await telInputs[i].fill('');
      await page.keyboard.type(otp[i], { delay: 80 });
    }
  } else {
    await telInputs[0].click();
    await telInputs[0].fill('');
    await page.keyboard.type(otp, { delay: 80 });
  }
  await page.waitForTimeout(800);
  const values = await page.locator('input[type="tel"], input[inputmode="numeric"], input[type="number"]').evaluateAll(xs => xs.map(x => x.value).join(''));
  console.log('OTP_VALUES', values);
  const verifyButton = page.locator("button:has-text('Xác thực'), button:has-text('Xac thuc'), button:has-text('Verify'), button[type='submit']").first();
  await verifyButton.waitFor({ state: 'visible', timeout: 10000 });
  await page.waitForFunction(() => [...document.querySelectorAll('button')].some(b => /Xác thực|Xac thuc|Verify/i.test(b.innerText || '') && !b.disabled), null, { timeout: 10000 }).catch(() => {});
  const buttons = await page.locator('button').evaluateAll(bs => bs.map(b => ({ text: b.innerText, disabled: b.disabled })));
  console.log('BUTTONS', JSON.stringify(buttons));
  const enabledVerify = page.locator("button:has-text('Xác thực'):not([disabled]), button:has-text('Xac thuc'):not([disabled]), button:has-text('Verify'):not([disabled])").first();
  if (await enabledVerify.isVisible().catch(() => false)) await enabledVerify.click();
  else await verifyButton.click();
  await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(4000);
}

try {
  await login();
  const bodyAfterLogin = await page.locator('body').innerText().catch(() => '');
  if (/OTP|mã xác thực|xac thuc|verification|Xác thực/i.test(bodyAfterLogin)) {
    await submitOtp();
  }

  const bodyAfterOtp = await page.locator('body').innerText().catch(() => '');
  if (/Mã OTP|Bạn không nhận được mã|Gửi lại mã|Xác thực/i.test(bodyAfterOtp) && await page.locator('input[type="tel"], input[inputmode="numeric"], input[type="number"]').first().isVisible().catch(() => false)) {
    console.log('OTP_STILL_REQUIRED_OR_INVALID');
    console.log('BODY_AFTER_OTP', bodyAfterOtp.slice(0, 1200));
    console.log('API', JSON.stringify(api.slice(-40), null, 2));
    await page.screenshot({ path: 'artifacts/hermes-probe-otp-after-submit.png', fullPage: true }).catch(() => {});
    process.exitCode = 4;
  } else {
    await page.goto(new URL('/saleman-working-schedule', config.hermesLoginUrl).toString(), { waitUntil: 'domcontentloaded' }).catch(e => console.log('GOTO_SCHEDULE_ERR', e.message));
    await page.waitForTimeout(8000);
    await page.screenshot({ path: 'artifacts/hermes-after-login.png', fullPage: true }).catch(() => {});
    console.log('URL', page.url());
    console.log('TITLE', await page.title().catch(() => ''));
    console.log('BODY', (await page.locator('body').innerText().catch(() => '')).slice(0, 6000));
    console.log('API', JSON.stringify(api.slice(-120), null, 2));
  }
} finally {
  await browser.close().catch(() => {});
}
