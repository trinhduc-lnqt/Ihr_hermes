import { chromium } from "playwright";

import { config } from "./config.js";

const USERNAME_SELECTORS = [
  "#txtuserid",
  "#txtUserId",
  "#username",
  "#userName",
  "#UserName",
  "input[name='UserId']",
  "input[name='username']",
  "input[name='userName']",
  // Hermes currently labels the field as email in the UI, but the real Angular control is username.
  // Keep this before email/text fallbacks so the bot does not wait for a non-existent email control.
  "input[formcontrolname='username']",
  "input[type='email']",
  "input[formcontrolname='email']",
  "input[placeholder*='Email' i]",
  "input[placeholder*='đăng nhập' i]",
  "input[placeholder*='dang nhap' i]",
  "input[type='text']"
];

const PASSWORD_SELECTORS = [
  "#txtpassword",
  "#txtPassword",
  "#password",
  "#Password",
  "input[name='Password']",
  "input[name='password']",
  "input[formcontrolname='password']",
  "input[placeholder*='Mật khẩu' i]",
  "input[placeholder*='Mat khau' i]",
  "input[type='password']"
];

const OTP_SELECTORS = [
  "input[autocomplete='one-time-code']",
  "input[name*='otp' i]",
  "input[id*='otp' i]",
  "input[formcontrolname*='otp' i]",
  "input[placeholder*='OTP' i]",
  "input[placeholder*='mã' i]",
  "input[placeholder*='ma' i]",
  "input[inputmode='numeric']",
  "input[type='tel']",
  "input[type='number']"
];

const SUBMIT_SELECTORS = [
  "#btnlogin",
  "#btnLogin",
  "button[type='submit']",
  "input[type='submit']",
  "button:has-text('Đăng nhập')",
  "button:has-text('Dang nhap')",
  "button:has-text('Login')",
  "a:has-text('Đăng nhập')",
  "a:has-text('Login')"
];

const OTP_SUBMIT_SELECTORS = [
  "button[type='submit']",
  "input[type='submit']",
  "button:has-text('Xác nhận')",
  "button:has-text('Xac nhan')",
  "button:has-text('Tiếp tục')",
  "button:has-text('Tiep tuc')",
  "button:has-text('Gửi')",
  "button:has-text('Gui')",
  "button:has-text('Đăng nhập')",
  "button:has-text('Login')"
];

const ERROR_SELECTORS = [
  "#lblMessage",
  ".validation-summary-errors",
  ".field-validation-error",
  ".alert-danger",
  ".toast-error",
  ".k-notification-error",
  "text=/sai|không đúng|khong dung|thất bại|that bai|invalid|incorrect/i"
];

let activeHermesSession = null;

async function fillFirstVisible(page, selectors, value, label) {
  await page.waitForSelector("input", { state: "visible", timeout: config.timeoutMs });
  for (let attempt = 0; attempt < 20; attempt += 1) {
    for (const selector of selectors) {
      const locator = page.locator(selector).first();
      const visible = await locator.isVisible().catch(() => false);
      if (!visible) {
        continue;
      }
      await locator.click({ timeout: 5000 });
      await locator.fill("", { timeout: 5000 });
      await locator.pressSequentially(value, { delay: 20, timeout: 10000 });
      return selector;
    }
    await page.waitForTimeout(250);
  }

  const visibleInputs = await page.locator("input").evaluateAll((inputs) => inputs
    .filter((input) => !!(input.offsetWidth || input.offsetHeight || input.getClientRects().length))
    .map((input) => ({
      type: input.getAttribute("type"),
      id: input.id || "",
      name: input.getAttribute("name") || "",
      formcontrolname: input.getAttribute("formcontrolname") || "",
      placeholder: input.getAttribute("placeholder") || "",
      className: String(input.className || "")
    }))
  ).catch(() => []);

  throw new Error(`Khong tim thay o nhap ${label} tren trang Hermes. Visible inputs: ${JSON.stringify(visibleInputs)}`);
}

async function clickFirstVisible(page, selectors) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    for (const selector of selectors) {
      const locator = page.locator(selector).first();
      const visible = await locator.isVisible().catch(() => false);
      if (!visible) {
        continue;
      }
      await locator.click({ timeout: 5000 });
      return selector;
    }
    await page.waitForTimeout(250);
  }
  await page.keyboard.press("Enter");
  return "Enter";
}

async function getVisibleOtpInputs(page) {
  const inputs = [];
  const seen = new Set();
  for (const selector of OTP_SELECTORS) {
    const locators = await page.locator(selector).all().catch(() => []);
    for (const locator of locators) {
      const handle = await locator.elementHandle().catch(() => null);
      if (!handle) {
        continue;
      }
      const key = await handle.evaluate((el) => {
        if (!el.dataset.miuOtpKey) {
          el.dataset.miuOtpKey = crypto.randomUUID?.() || `${Date.now()}-${Math.random()}`;
        }
        return el.dataset.miuOtpKey;
      }).catch(() => null);
      if (!key || seen.has(key)) {
        continue;
      }
      seen.add(key);
      const visible = await locator.isVisible().catch(() => false);
      const enabled = await locator.isEnabled().catch(() => false);
      if (visible && enabled) {
        inputs.push(locator);
      }
    }
  }
  return inputs;
}

async function fillOtp(page, otp) {
  const normalizedOtp = String(otp || "").trim().replace(/\s+/g, "");
  const otpInputs = await getVisibleOtpInputs(page);
  if (otpInputs.length === 0) {
    throw new Error("Khong tim thay o nhap OTP tren trang Hermes.");
  }

  if (otpInputs.length > 1 && normalizedOtp.length >= otpInputs.length) {
    for (let index = 0; index < otpInputs.length; index += 1) {
      await otpInputs[index].click();
      await otpInputs[index].fill("");
      await otpInputs[index].pressSequentially(normalizedOtp[index] || "", { delay: 50 });
    }
  } else {
    const input = otpInputs[0];
    await input.click();
    await input.fill("");
    await input.pressSequentially(normalizedOtp, { delay: 50 });
  }

  await page.waitForTimeout(500);
  return otpInputs.length;
}

async function clickOtpSubmit(page) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    for (const selector of OTP_SUBMIT_SELECTORS) {
      const locator = page.locator(selector).first();
      const visible = await locator.isVisible().catch(() => false);
      const enabled = await locator.isEnabled().catch(() => false);
      if (visible && enabled) {
        await locator.click();
        return selector;
      }
    }
    await page.waitForTimeout(300);
  }
  await page.keyboard.press("Enter");
  return "Enter";
}

async function readFirstText(page, selectors) {
  for (const selector of selectors) {
    const locator = page.locator(selector).first();
    const visible = await locator.isVisible().catch(() => false);
    if (!visible) {
      continue;
    }
    const text = await locator.textContent().catch(() => "");
    if (text?.trim()) {
      return text.trim();
    }
  }
  return "";
}

function createApiCapture(page) {
  const apiResponses = [];
  page.on("response", async (response) => {
    const url = response.url();
    if (!url.includes("/api/")) {
      return;
    }
    const request = response.request();
    let body = "";
    const contentType = response.headers()["content-type"] || "";
    if (contentType.includes("json") || /\/api\/user\/(pre-login|get-otp|verify|login)/i.test(url) || /\/api\/support-online\/working-schedule\/list/i.test(url)) {
      body = await response.text().catch(() => "");
    }
    apiResponses.push({
      url,
      method: request.method(),
      status: response.status(),
      requestBody: request.postData() || "",
      body
    });
  });
  return apiResponses;
}

function parseJsonSafe(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function getApiErrorText(apiResponses, urlPattern) {
  for (const response of [...apiResponses].reverse()) {
    if (!urlPattern.test(response.url)) {
      continue;
    }
    const data = parseJsonSafe(response.body);
    const statusText = String(data?.status || data?.Status || "").toUpperCase();
    const hasExplicitError = Boolean(data?.error || data?.EXCEPTION_MESSAGE || statusText === "FAIL" || statusText === "FAILED" || response.status >= 400);
    if (!hasExplicitError || statusText === "SUCCESS") {
      continue;
    }
    const message = data?.message || data?.error?.message || data?.EXCEPTION_MESSAGE;
    if (message) {
      return String(message).trim();
    }
  }
  return "";
}

async function hasVisibleOtpInput(page) {
  for (const selector of OTP_SELECTORS) {
    const visible = await page.locator(selector).first().isVisible().catch(() => false);
    if (visible) {
      return true;
    }
  }
  const bodyText = await page.locator("body").innerText({ timeout: 5000 }).catch(() => "");
  return /\bOTP\b|mã xác thực|ma xac thuc|xác minh|xac minh|verification code/i.test(bodyText);
}

async function isLoggedIn(page) {
  const passwordStillVisible = await page.locator("input[type='password']").first().isVisible().catch(() => false);
  const currentUrl = page.url();
  const stayedOnLogin = currentUrl.includes(config.hermesLoginUrl) || /login|dang-?nhap/i.test(currentUrl);
  return !passwordStillVisible && !stayedOnLogin;
}

async function closeActiveHermesSession() {
  if (!activeHermesSession) {
    return;
  }
  const session = activeHermesSession;
  activeHermesSession = null;
  clearTimeout(session.timer);
  await session.browser.close().catch(() => {});
}

export async function validateHermesLogin({ username, password, keepOtpSession = false }) {
  await closeActiveHermesSession();
  if (!config.hermesLoginUrl) {
    return {
      ok: true,
      skipped: true,
      message: "Chua cau hinh HERMES_LOGIN_URL, da luu tai khoan Hermes nhung chua test dang nhap."
    };
  }

  const browser = await chromium.launch({ headless: config.headless });
  const context = await browser.newContext({
    ignoreHTTPSErrors: true,
    locale: config.locale,
    timezoneId: config.timezoneId,
    viewport: { width: 1365, height: 900 }
  });
  const page = await context.newPage();
  page.setDefaultTimeout(config.timeoutMs);
  const apiResponses = createApiCapture(page);

  try {
    await page.goto(config.hermesLoginUrl, { waitUntil: "domcontentloaded", timeout: config.timeoutMs });
    await page.waitForSelector("input", { state: "visible", timeout: config.timeoutMs });
    await page.waitForTimeout(500);
    await fillFirstVisible(page, USERNAME_SELECTORS, username, "tai khoan");
    await fillFirstVisible(page, PASSWORD_SELECTORS, password, "mat khau");
    await clickFirstVisible(page, SUBMIT_SELECTORS);
    // Hermes keeps polling/analytics requests alive, so networkidle can hang for the full action timeout.
    // The useful login result (error or OTP screen) normally renders within a few seconds.
    await page.waitForTimeout(3000);

    const errorText = await readFirstText(page, ERROR_SELECTORS) || getApiErrorText(apiResponses, /\/api\/user\/pre-login/i);
    if (errorText) {
      return { ok: false, message: `Dang nhap Hermes that bai: ${errorText}` };
    }

    if (await hasVisibleOtpInput(page)) {
      if (!keepOtpSession) {
        return { ok: false, otpRequired: true, message: "Hermes yeu cau OTP." };
      }
      const timer = setTimeout(() => {
        closeActiveHermesSession().catch(() => {});
      }, Math.max(config.hermesOtpTimeoutMs, 60_000));
      activeHermesSession = { browser, context, page, username, timer };
      return { ok: false, otpRequired: true, message: "Hermes yeu cau OTP. Hay gui ma OTP de em xac nhan tiep." };
    }

    if (!(await isLoggedIn(page))) {
      return { ok: false, message: "Hermes van dung o man hinh dang nhap, kha nang sai tai khoan/mat khau." };
    }

    return { ok: true, message: "Dang nhap Hermes OK." };
  } catch (error) {
    return { ok: false, message: error.message || "Khong test duoc dang nhap Hermes." };
  } finally {
    if (!activeHermesSession || activeHermesSession.browser !== browser) {
      await browser.close().catch(() => {});
    }
  }
}

export async function submitHermesOtp(otp) {
  if (!activeHermesSession) {
    return { ok: false, expired: true, message: "Khong co phien Hermes nao dang cho OTP hoac phien da het han." };
  }

  const session = activeHermesSession;
  const { page } = session;
  try {
    await fillOtp(page, otp);
    await clickOtpSubmit(page);
    await page.waitForLoadState("networkidle", { timeout: config.timeoutMs }).catch(() => {});
    await page.waitForTimeout(1500);

    const errorText = await readFirstText(page, ERROR_SELECTORS);
    if (errorText) {
      return { ok: false, message: `OTP Hermes that bai: ${errorText}` };
    }

    if (await hasVisibleOtpInput(page)) {
      return { ok: false, otpRequired: true, message: "Hermes van dang cho OTP. Ma vua nhap co the chua dung hoac chua du." };
    }

    if (!(await isLoggedIn(page))) {
      return { ok: false, message: "Da gui OTP nhung Hermes chua vao duoc trang sau dang nhap." };
    }

    return { ok: true, message: "Dang nhap Hermes OK sau OTP." };
  } catch (error) {
    return { ok: false, message: error.message || "Khong xac nhan duoc OTP Hermes." };
  } finally {
    await closeActiveHermesSession();
  }
}

function getHermesBaseUrl() {
  if (config.hermesBaseUrl) {
    return config.hermesBaseUrl;
  }
  if (config.hermesLoginUrl) {
    return new URL(config.hermesLoginUrl).origin;
  }
  return "";
}

function toHermesLocalDate(date) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: config.timezoneId,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function fromHermesLocalDate(value) {
  const match = String(value || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) {
    return null;
  }
  return new Date(`${match[1]}-${match[2]}-${match[3]}T00:00:00+07:00`);
}

function addDays(date, days) {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function getWeekRange(date) {
  const localDate = fromHermesLocalDate(toHermesLocalDate(date));
  const day = localDate.getUTCDay() || 7;
  const start = addDays(localDate, 1 - day);
  const end = addDays(start, 6);
  return { start, end };
}

function formatHermesDateTime(date, endOfDay = false) {
  return `${toHermesLocalDate(date)} ${endOfDay ? "23:59:59" : "00:00:00"}`;
}

function buildScheduleUrl(targetDate) {
  const baseUrl = getHermesBaseUrl();
  if (!baseUrl) {
    throw new Error("Chua cau hinh HERMES_BASE_URL/HERMES_LOGIN_URL.");
  }
  const { start, end } = getWeekRange(targetDate);
  const params = new URLSearchParams({
    startTime: formatHermesDateTime(start),
    endTime: formatHermesDateTime(end, true),
    deptCode: "HAN_SUPPORT",
    teamId: "5fe9bcb15885324fa7a01a02",
    page: "0"
  });
  return `${baseUrl}/api/support-online/working-schedule/list?${params.toString()}`;
}

function parseScheduleResponse(text) {
  const data = parseJsonSafe(text);
  if (!data) {
    return [];
  }
  if (Array.isArray(data)) {
    return data;
  }
  if (Array.isArray(data.data)) {
    return data.data;
  }
  if (Array.isArray(data.items)) {
    return data.items;
  }
  if (Array.isArray(data.result)) {
    return data.result;
  }
  if (Array.isArray(data.data?.items)) {
    return data.data.items;
  }
  if (Array.isArray(data.data?.content)) {
    return data.data.content;
  }
  return [];
}

function collectScheduleItems(value, targetDateText, output = []) {
  if (!value || typeof value !== "object") {
    return output;
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      collectScheduleItems(item, targetDateText, output);
    }
    return output;
  }

  const text = JSON.stringify(value);
  const hasTargetDate = text.includes(targetDateText);
  const hasUsefulScheduleSignal = /#\d{5,}|Lịch trực|Lich truc|Nghỉ|Nghi|Đã phân lịch|Da phan lich|Tạm dừng|Tam dung|FABI|iPOS|CRM/i.test(text);
  if (hasTargetDate && hasUsefulScheduleSignal) {
    output.push(value);
  }

  for (const child of Object.values(value)) {
    if (child && typeof child === "object") {
      collectScheduleItems(child, targetDateText, output);
    }
  }
  return output;
}

function flattenScheduleText(value) {
  const seen = new Set();
  const parts = [];
  const visit = (item) => {
    if (item === null || item === undefined) {
      return;
    }
    if (typeof item === "string" || typeof item === "number" || typeof item === "boolean") {
      const text = String(item).trim();
      if (text && !seen.has(text)) {
        seen.add(text);
        parts.push(text);
      }
      return;
    }
    if (Array.isArray(item)) {
      for (const child of item) {
        visit(child);
      }
      return;
    }
    if (typeof item === "object") {
      for (const child of Object.values(item)) {
        visit(child);
      }
    }
  };
  visit(value);
  return parts;
}

function extractScheduleEntriesFromBody(bodyText, targetDate) {
  const targetDateText = toHermesLocalDate(targetDate);
  const lineItems = [];
  const lines = String(bodyText || "").split("\n").map((line) => line.trim()).filter(Boolean);
  const userIndex = lines.findIndex((line) => /^duc\.dao$/i.test(line));
  if (userIndex >= 0) {
    const stopUserPattern = /^(tam\.ha|duong\.tran|quang\.phuong|anh\.phan|lam\.nguyen|hiep\.le|huy\.nguyen02|cong\.nguyen01|linh\.tran02|dat\.tran02|bo\.nguyen01)$/i;
    const block = [];
    for (const line of lines.slice(userIndex + 1)) {
      if (stopUserPattern.test(line)) {
        break;
      }
      block.push(line);
    }
    for (let index = 0; index < block.length; index += 1) {
      const line = block[index];
      if (/^#\d+\b|^Lịch trực$|^Nghỉ$|^Hỗ trợ tiếp$/i.test(line)) {
        const next = block[index + 1] || "";
        if (/^(Đã phân lịch|Tạm dừng|Đã hoàn thành|Chờ lịch)$/i.test(next)) {
          lineItems.push(`${line} — ${next}`);
          index += 1;
        } else {
          lineItems.push(line);
        }
      }
    }
  }

  return lineItems.map((text) => ({ text, date: targetDateText }));
}

function normalizeScheduleEntriesFromApi(apiResponses, targetDate) {
  const targetDateText = toHermesLocalDate(targetDate);
  const response = [...apiResponses].reverse().find((item) => /\/api\/support-online\/working-schedule\/list/i.test(item.url));
  if (!response?.body) {
    return [];
  }
  const roots = parseScheduleResponse(response.body);
  const rawItems = collectScheduleItems(roots, targetDateText);
  return rawItems.map((item) => {
    const parts = flattenScheduleText(item);
    const text = parts
      .filter((part) => !/^([a-f0-9]{24}|true|false|null)$/i.test(part))
      .filter((part) => part !== targetDateText)
      .join(" | ");
    return { text: text || JSON.stringify(item), raw: item, date: targetDateText };
  });
}

async function loginHermesPage({ username, password }) {
  const browser = await chromium.launch({ headless: config.headless });
  const context = await browser.newContext({
    ignoreHTTPSErrors: true,
    locale: config.locale,
    timezoneId: config.timezoneId,
    viewport: { width: 1365, height: 900 }
  });
  const page = await context.newPage();
  page.setDefaultTimeout(config.timeoutMs);
  const apiResponses = createApiCapture(page);

  await page.goto(config.hermesLoginUrl, { waitUntil: "domcontentloaded", timeout: config.timeoutMs });
  await page.waitForSelector("input", { state: "visible", timeout: config.timeoutMs });
  await page.waitForTimeout(500);
  await fillFirstVisible(page, USERNAME_SELECTORS, username, "tai khoan");
  await fillFirstVisible(page, PASSWORD_SELECTORS, password, "mat khau");
  await clickFirstVisible(page, SUBMIT_SELECTORS);
  await page.waitForTimeout(3000);

  const errorText = await readFirstText(page, ERROR_SELECTORS) || getApiErrorText(apiResponses, /\/api\/user\/pre-login/i);
  if (errorText) {
    await browser.close().catch(() => {});
    return { ok: false, message: `Dang nhap Hermes that bai: ${errorText}` };
  }

  if (await hasVisibleOtpInput(page)) {
    const timer = setTimeout(() => {
      closeActiveHermesSession().catch(() => {});
    }, Math.max(config.hermesOtpTimeoutMs, 60_000));
    activeHermesSession = { browser, context, page, username, timer, apiResponses, purpose: "work_schedule" };
    return { ok: false, otpRequired: true, message: "Hermes yeu cau OTP. Hay gui ma OTP de em xac nhan tiep." };
  }

  if (!(await isLoggedIn(page))) {
    await browser.close().catch(() => {});
    return { ok: false, message: "Hermes van dung o man hinh dang nhap, kha nang sai tai khoan/mat khau." };
  }

  return { ok: true, browser, context, page, apiResponses };
}

async function readScheduleFromLoggedInPage(page, apiResponses, targetDate) {
  const scheduleUrl = new URL("/support-working-schedule", config.hermesLoginUrl).toString();
  await page.goto(scheduleUrl, { waitUntil: "domcontentloaded", timeout: config.timeoutMs }).catch(() => {});
  await page.waitForTimeout(7000);

  const apiUrl = buildScheduleUrl(targetDate);
  const fetched = await page.evaluate(async (url) => {
    const response = await fetch(url, { credentials: "include" });
    return { status: response.status, body: await response.text() };
  }, apiUrl).catch(() => null);
  if (fetched) {
    apiResponses.push({ url: apiUrl, method: "GET", status: fetched.status, requestBody: "", body: fetched.body });
  }

  let entries = normalizeScheduleEntriesFromApi(apiResponses, targetDate);
  if (!entries.length) {
    const bodyText = await page.locator("body").innerText({ timeout: 5000 }).catch(() => "");
    entries = extractScheduleEntriesFromBody(bodyText, targetDate);
  }

  return {
    ok: true,
    targetDate: toHermesLocalDate(targetDate),
    checkedAt: new Date(),
    entries,
    message: entries.length ? "Co lich lam viec." : "Khong co lich lam viec."
  };
}

export function parseWorkScheduleDateInput(text, now = new Date()) {
  const raw = String(text || "").trim().toLowerCase();
  if (!raw || /^(hôm nay|hom nay|today|nay)$/i.test(raw)) {
    return fromHermesLocalDate(toHermesLocalDate(now));
  }
  if (/^(mai|ngày mai|ngay mai|tomorrow)$/i.test(raw)) {
    return addDays(fromHermesLocalDate(toHermesLocalDate(now)), 1);
  }
  const slash = raw.match(/^(\d{1,2})[\/\-](\d{1,2})(?:[\/\-](\d{4}))?$/);
  if (slash) {
    const day = slash[1].padStart(2, "0");
    const month = slash[2].padStart(2, "0");
    const year = slash[3] || new Intl.DateTimeFormat("en", { timeZone: config.timezoneId, year: "numeric" }).format(now);
    return fromHermesLocalDate(`${year}-${month}-${day}`);
  }
  const iso = raw.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (iso) {
    return fromHermesLocalDate(`${iso[1]}-${iso[2].padStart(2, "0")}-${iso[3].padStart(2, "0")}`);
  }
  return null;
}

export function formatWorkScheduleResult(result) {
  const checkedAt = new Intl.DateTimeFormat("vi-VN", {
    dateStyle: "short",
    timeStyle: "medium",
    timeZone: config.timezoneId
  }).format(result.checkedAt || new Date());
  const target = fromHermesLocalDate(result.targetDate);
  const targetLabel = new Intl.DateTimeFormat("vi-VN", {
    weekday: "long",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    timeZone: config.timezoneId
  }).format(target || new Date());

  const lines = [
    `Lịch làm việc ${targetLabel}`,
    `Thời điểm kiểm tra: ${checkedAt}`,
    ""
  ];

  if (!result.entries?.length) {
    lines.push("Không có lịch.");
    return lines.join("\n");
  }

  lines.push("Có lịch:");
  for (const entry of result.entries.slice(0, 20)) {
    lines.push(`- ${entry.text}`);
  }
  if (result.entries.length > 20) {
    lines.push(`... và ${result.entries.length - 20} mục nữa.`);
  }
  return lines.join("\n");
}

export async function getWorkScheduleByDay({ username, password, date = new Date() }) {
  if (!config.hermesLoginUrl) {
    return { ok: false, message: "Chua cau hinh HERMES_LOGIN_URL." };
  }

  const login = await loginHermesPage({ username, password });
  if (!login.ok) {
    return login;
  }

  try {
    return await readScheduleFromLoggedInPage(login.page, login.apiResponses, date);
  } catch (error) {
    return { ok: false, message: error.message || "Khong lay duoc lich lam viec Hermes." };
  } finally {
    await login.browser.close().catch(() => {});
  }
}

export async function submitHermesOtpAndGetWorkSchedule(otp, date = new Date()) {
  if (!activeHermesSession) {
    return { ok: false, expired: true, message: "Khong co phien Hermes nao dang cho OTP hoac phien da het han." };
  }

  const session = activeHermesSession;
  const { page } = session;
  try {
    await fillOtp(page, otp);
    await clickOtpSubmit(page);
    await page.waitForLoadState("networkidle", { timeout: config.timeoutMs }).catch(() => {});
    await page.waitForTimeout(1500);

    const errorText = await readFirstText(page, ERROR_SELECTORS);
    if (errorText) {
      return { ok: false, message: `OTP Hermes that bai: ${errorText}` };
    }

    if (await hasVisibleOtpInput(page)) {
      return { ok: false, otpRequired: true, message: "Hermes van dang cho OTP. Ma vua nhap co the chua dung hoac chua du." };
    }

    if (!(await isLoggedIn(page))) {
      return { ok: false, message: "Da gui OTP nhung Hermes chua vao duoc trang sau dang nhap." };
    }

    return await readScheduleFromLoggedInPage(page, session.apiResponses || [], date);
  } catch (error) {
    return { ok: false, message: error.message || "Khong xac nhan duoc OTP Hermes." };
  } finally {
    await closeActiveHermesSession();
  }
}

export async function cancelHermesOtpSession() {
  await closeActiveHermesSession();
}
