import { chromium, request as playwrightRequest } from 'playwright';
import { getSalarySlip } from '../src/ihrClient.js';

const username = process.env.IHR_USERNAME || 'duc.dao';
const password = process.env.IHR_PASSWORD || 'lynhan@123';
const baseUrl = 'https://ihr.ipos.vn';

const api = await playwrightRequest.newContext({
  baseURL: baseUrl,
  ignoreHTTPSErrors: true,
  extraHTTPHeaders: { 'accept-language': 'vi-VN' }
});
await api.post('/Login/CheckUserLogin/', {
  form: { UserId: username, Password: password, Language: 'vi' },
  headers: { 'x-requested-with': 'XMLHttpRequest', 'accept-language': 'vi-VN' },
  timeout: 45000
});
const storageState = await api.storageState();

const result = await getSalarySlip({ username, password, month: new Date(2026, 2, 1) });
if (!result.ok) throw new Error(result.message);

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  ignoreHTTPSErrors: true,
  viewport: { width: 1440, height: 2400 },
  storageState
});
const page = await context.newPage();

const previewUrl = `${baseUrl}/PDF/preview?id=/${encodeURIComponent(result.relativeFilePath)}`;
console.log('PREVIEW URL', previewUrl);
await page.goto(previewUrl, { waitUntil: 'networkidle', timeout: 60000 }).catch(async () => {
  await page.goto(`${baseUrl}/${result.relativeFilePath}`, { waitUntil: 'load', timeout: 60000 });
});
await page.waitForTimeout(3000);
await page.screenshot({ path: 'salary-preview-test.png', fullPage: true });
console.log('TITLE', await page.title());
console.log('BODY', (await page.locator('body').innerText().catch(() => '')).slice(0, 2000));
await browser.close();
await api.dispose();
