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

function parseHermesLocalDateParts(value) {
  const match = String(value || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  return { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) };
}

function fromHermesLocalDate(value) {
  const parts = parseHermesLocalDateParts(value);
  if (!parts) {
    return null;
  }
  return new Date(Date.UTC(parts.year, parts.month - 1, parts.day, 12, 0, 0));
}

function hermesLocalDayOfWeek(date) {
  const parts = parseHermesLocalDateParts(toHermesLocalDate(date));
  const noonUtc = new Date(Date.UTC(parts.year, parts.month - 1, parts.day, 12, 0, 0));
  return noonUtc.getUTCDay() || 7;
}

function addHermesLocalDays(date, days) {
  const parts = parseHermesLocalDateParts(toHermesLocalDate(date));
  return new Date(Date.UTC(parts.year, parts.month - 1, parts.day + days, 12, 0, 0));
}

function addDays(date, days) {
  return addHermesLocalDays(date, days);
}

function getWeekRange(date) {
  const localDate = fromHermesLocalDate(toHermesLocalDate(date));
  const day = hermesLocalDayOfWeek(localDate);
  const start = addHermesLocalDays(localDate, 1 - day);
  const end = addHermesLocalDays(start, 6);
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

function isPlainObject(value) {
  return value && typeof value === "object" && !Array.isArray(value);
}

function objectHasDirectScheduleSignal(value) {
  if (!isPlainObject(value)) {
    return false;
  }
  const keys = Object.keys(value).map((key) => key.toLowerCase());
  return keys.some((key) => /schedule|working|work|ticket|request|calendar|support|type|status|start|end|date|link|url/.test(key));
}

function valueContainsTargetDate(value, targetDateText) {
  if (value === null || value === undefined) return false;
  if (typeof value !== "object") return String(value).includes(targetDateText);
  return Object.values(value).some((child) => valueContainsTargetDate(child, targetDateText));
}

function collectScheduleItems(value, targetDateText, output = [], depth = 0) {
  if (!value || typeof value !== "object") {
    return output;
  }

  if (Array.isArray(value)) {
    const directMatches = value.filter((item) => {
      if (!isPlainObject(item)) return false;
      const text = JSON.stringify(item);
      return valueContainsTargetDate(item, targetDateText)
        && objectHasDirectScheduleSignal(item)
        && /#\d{5,}|Lịch trực|Lich truc|Nghỉ|Nghi|Đã phân lịch|Da phan lich|Tạm dừng|Tam dung|FABI|iPOS|CRM/i.test(text);
    });
    if (directMatches.length) {
      output.push(...directMatches);
      return output;
    }
    for (const item of value) {
      collectScheduleItems(item, targetDateText, output, depth + 1);
    }
    return output;
  }

  const text = JSON.stringify(value);
  const hasTargetDate = valueContainsTargetDate(value, targetDateText);
  const hasUsefulScheduleSignal = /#\d{5,}|Lịch trực|Lich truc|Nghỉ|Nghi|Đã phân lịch|Da phan lich|Tạm dừng|Tam dung|FABI|iPOS|CRM/i.test(text);
  if (hasTargetDate && hasUsefulScheduleSignal && objectHasDirectScheduleSignal(value)) {
    output.push(value);
    return output;
  }

  for (const child of Object.values(value)) {
    if (child && typeof child === "object") {
      collectScheduleItems(child, targetDateText, output, depth + 1);
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

  return lineItems.map((text, index) => {
    const links = collectLinks(text);
    return {
      id: `${targetDateText}-body-${index}`,
      ticket: text.match(/#\d{5,}/)?.[0] || "",
      type: detectScheduleType(text),
      status: text.match(/Đã phân lịch|Tạm dừng|Đã hoàn thành|Chờ lịch|Nghỉ/i)?.[0] || "",
      product: text.replace(/^#\d+\s*-\s*/, "").replace(/\s+—\s+.*$/, ""),
      customer: "",
      owner: "duc.dao",
      shift: "",
      time: "",
      note: "",
      links,
      link: links[0] || "",
      text,
      date: targetDateText
    };
  });
}

async function extractScheduleEntriesFromDom(page, targetDate) {
  const targetDateText = toHermesLocalDate(targetDate);
  const rawItems = await page.evaluate((target) => {
    const clean = (value) => String(value || "").replace(/\s+/g, " ").trim();
    const headers = [...document.querySelectorAll(".header-wrapper .date-in-week")].map((element) => {
      const rect = element.getBoundingClientRect();
      const text = clean(element.innerText);
      const date = text.match(/\d{4}-\d{2}-\d{2}/)?.[0] || "";
      return { date, left: rect.left, right: rect.right, width: rect.width };
    }).filter((item) => item.date);
    const targetHeader = headers.find((item) => item.date === target);
    if (!targetHeader) {
      return [];
    }

    const rows = [...document.querySelectorAll(".employee-wrapper")];
    const row = rows.find((element) => /(^|\s)duc\.dao(\s|$)/i.test(clean(element.querySelector(".emp-info")?.innerText || element.innerText)));
    if (!row) {
      return [];
    }

    const dayWidth = targetHeader.width || (targetHeader.right - targetHeader.left) || 1;
    const items = [...row.querySelectorAll(".grid-stack-item")].map((element) => {
      const rect = element.getBoundingClientRect();
      const overlap = Math.max(0, Math.min(rect.right, targetHeader.right) - Math.max(rect.left, targetHeader.left));
      return {
        text: clean(element.innerText),
        className: String(element.className || ""),
        html: element.innerHTML,
        left: rect.left,
        right: rect.right,
        width: rect.width,
        overlap
      };
    });

    return items
      .filter((item) => item.text && item.overlap >= Math.min(20, dayWidth * 0.2))
      .map((item) => ({ text: item.text, className: item.className, html: item.html }));
  }, targetDateText).catch(() => []);

  const typeFromClass = (className, text) => {
    if (/type-busy/i.test(className)) return "Lịch trực";
    if (/type-onsite/i.test(className)) return "Onsite";
    if (/type-deploy-extra/i.test(className)) return "Triển khai thêm";
    if (/type-deploy/i.test(className)) return "Triển khai";
    if (/type-maintain|type-maintenance/i.test(className)) return "Bảo trì";
    if (/type-leave|type-off/i.test(className)) return "Nghỉ";
    return detectScheduleType(text);
  };

  return rawItems.map((item, index) => {
    const text = item.text;
    const links = collectLinks(`${text}\n${item.html || ""}`);
    const status = text.match(/Đã phân lịch|Tạm dừng|Đã hoàn thành|Chờ lịch|Nghỉ/i)?.[0] || "";
    const product = text
      .replace(/^#\d+\s*-\s*/, "")
      .replace(/\s+(Đã phân lịch|Tạm dừng|Đã hoàn thành|Chờ lịch)$/i, "")
      .trim();
    return {
      id: `${targetDateText}-dom-${index}`,
      ticket: text.match(/#\d{5,}/)?.[0] || "",
      type: typeFromClass(item.className, text),
      status,
      product,
      customer: "",
      owner: "duc.dao",
      shift: "",
      time: "",
      note: "",
      links,
      link: links[0] || "",
      text,
      date: targetDateText
    };
  });
}

function getFieldValue(item, names) {
  if (!item || typeof item !== "object") {
    return "";
  }
  const normalizedNames = names.map((name) => String(name).toLowerCase());
  const stack = [item];
  const seen = new Set();
  while (stack.length) {
    const current = stack.pop();
    if (!current || typeof current !== "object" || seen.has(current)) {
      continue;
    }
    seen.add(current);
    for (const [key, value] of Object.entries(current)) {
      const lowerKey = key.toLowerCase();
      if ((normalizedNames.includes(lowerKey) || normalizedNames.some((name) => lowerKey.includes(name))) && value !== null && value !== undefined && typeof value !== "object") {
        return String(value).trim();
      }
      if (value && typeof value === "object") {
        stack.push(value);
      }
    }
  }
  return "";
}

function collectLinks(item) {
  const links = [];
  const seenLinks = new Set();
  const stack = [item];
  const seen = new Set();
  while (stack.length) {
    const current = stack.pop();
    if (current === null || current === undefined || seen.has(current)) continue;
    if (typeof current === "string") {
      const matches = current.match(/https?:\/\/[^\s"'<>]+/gi) || [];
      for (const link of matches) {
        if (!seenLinks.has(link)) {
          seenLinks.add(link);
          links.push(link);
        }
      }
      continue;
    }
    if (typeof current !== "object") continue;
    seen.add(current);
    for (const [key, value] of Object.entries(current)) {
      const lowerKey = key.toLowerCase();
      if (/url|link|href/.test(lowerKey) && typeof value === "string" && value.trim()) {
        let link = value.trim();
        if (link.startsWith("/")) {
          const baseUrl = getHermesBaseUrl();
          link = baseUrl ? `${baseUrl}${link}` : link;
        }
        if (!seenLinks.has(link)) {
          seenLinks.add(link);
          links.push(link);
        }
      }
      if (value && typeof value === "object") {
        stack.push(value);
      } else if (typeof value === "string") {
        const matches = value.match(/https?:\/\/[^\s"'<>]+/gi) || [];
        for (const link of matches) {
          if (!seenLinks.has(link)) {
            seenLinks.add(link);
            links.push(link);
          }
        }
      }
    }
  }
  return links;
}

function detectScheduleType(text) {
  if (/lịch trực|lich truc/i.test(text)) return "Lịch trực";
  if (/nghỉ|nghi/i.test(text)) return "Nghỉ";
  if (/hỗ trợ tiếp|ho tro tiep/i.test(text)) return "Hỗ trợ tiếp";
  if (/onsite/i.test(text)) return "Onsite";
  if (/bảo trì|bao tri/i.test(text)) return "Bảo trì";
  if (/triển khai thêm|trien khai them/i.test(text)) return "Triển khai thêm";
  if (/triển khai|trien khai/i.test(text)) return "Triển khai";
  return "Lịch làm việc";
}

function buildScheduleEntry(item, targetDateText, fallbackIndex = 0) {
  const parts = flattenScheduleText(item);
  const cleanParts = parts
    .filter((part) => !/^([a-f0-9]{24}|true|false|null)$/i.test(part))
    .filter((part) => part !== targetDateText);
  const text = cleanParts.join(" | ") || JSON.stringify(item);
  const ticketMatch = text.match(/#\d{5,}/);
  const product = getFieldValue(item, ["productName", "product", "moduleName", "serviceName", "projectName"]);
  const customer = getFieldValue(item, ["customerName", "customer", "storeName", "merchantName", "shopName"]);
  const status = getFieldValue(item, ["statusName", "status", "scheduleStatus", "ticketStatus"])
    || (text.match(/Đã phân lịch|Tạm dừng|Đã hoàn thành|Chờ lịch|Nghỉ/i)?.[0] || "");
  const owner = getFieldValue(item, ["assignee", "assigneeName", "employeeName", "supporter", "supporterName", "username"]);
  const shift = getFieldValue(item, ["shift", "shiftName", "session", "sessionName", "timeName"])
    || (text.match(/\b(Sáng|Chiều|Tối)\b/i)?.[0] || "");
  const time = getFieldValue(item, ["startTime", "endTime", "fromTime", "toTime", "scheduleTime", "date", "workingDate", "workDate"]);
  const note = getFieldValue(item, ["note", "description", "content", "reason"]);
  const type = getFieldValue(item, ["typeName", "scheduleType", "scheduleTypeName", "workType", "workTypeName", "taskType", "taskTypeName"]) || detectScheduleType(text);
  const links = collectLinks(item);

  return {
    id: getFieldValue(item, ["id", "_id", "scheduleId"]) || `${targetDateText}-${fallbackIndex}`,
    ticket: ticketMatch?.[0] || "",
    type,
    status,
    product,
    customer,
    owner,
    shift,
    time,
    note,
    links,
    link: links[0] || "",
    text,
    raw: item,
    date: targetDateText
  };
}

function normalizeScheduleEntriesFromApi(apiResponses, targetDate) {
  const targetDateText = toHermesLocalDate(targetDate);
  const response = [...apiResponses].reverse().find((item) => /\/api\/support-online\/working-schedule\/list/i.test(item.url));
  if (!response?.body) {
    return [];
  }
  const roots = parseScheduleResponse(response.body);
  const rawItems = collectScheduleItems(roots, targetDateText);
  return rawItems.map((item, index) => buildScheduleEntry(item, targetDateText, index));
}

async function createHermesBrowserContext(storageState = null) {
  const browser = await chromium.launch({ headless: config.headless });
  const context = await browser.newContext({
    ignoreHTTPSErrors: true,
    locale: config.locale,
    timezoneId: config.timezoneId,
    viewport: { width: 1365, height: 900 },
    ...(storageState ? { storageState } : {})
  });
  const page = await context.newPage();
  page.setDefaultTimeout(config.timeoutMs);
  const apiResponses = createApiCapture(page);
  return { browser, context, page, apiResponses };
}

async function loginHermesPage({ username, password }) {
  const { browser, context, page, apiResponses } = await createHermesBrowserContext();

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

  if (await hasVisibleOtpInput(page) || !(await isLoggedIn(page))) {
    return { ok: false, sessionExpired: true, message: "Phiên Hermes đã hết hạn hoặc bị yêu cầu đăng nhập lại." };
  }

  const apiUrl = buildScheduleUrl(targetDate);
  const fetched = await page.evaluate(async (url) => {
    const response = await fetch(url, { credentials: "include" });
    return { status: response.status, body: await response.text() };
  }, apiUrl).catch(() => null);
  if (fetched) {
    apiResponses.push({ url: apiUrl, method: "GET", status: fetched.status, requestBody: "", body: fetched.body });
    if ([401, 403].includes(fetched.status) || /login|unauthori[sz]ed|otp|forbidden/i.test(fetched.body || "")) {
      return { ok: false, sessionExpired: true, message: "Phiên Hermes đã hết hạn hoặc API yêu cầu đăng nhập lại." };
    }
  }

  let entries = normalizeScheduleEntriesFromApi(apiResponses, targetDate);
  if (!entries.length) {
    entries = await extractScheduleEntriesFromDom(page, targetDate);
  }
  if (!entries.length) {
    const bodyText = await page.locator("body").innerText({ timeout: 5000 }).catch(() => "");
    const hasCalendarGrid = /T[2-7]|CN/.test(bodyText) && /\d{4}-\d{2}-\d{2}/.test(bodyText) && /duc\.dao/i.test(bodyText);
    if (!hasCalendarGrid) {
      entries = extractScheduleEntriesFromBody(bodyText, targetDate);
    }
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

export function getRelativeWorkScheduleDate(offsetDays = 0, now = new Date()) {
  return addDays(fromHermesLocalDate(toHermesLocalDate(now)), offsetDays);
}

export function formatWorkScheduleDetail(entry, result = {}) {
  const checkedAt = new Intl.DateTimeFormat("vi-VN", {
    dateStyle: "short",
    timeStyle: "medium",
    timeZone: config.timezoneId
  }).format(result.checkedAt || new Date());
  const target = fromHermesLocalDate(entry?.date || result.targetDate);
  const targetLabel = new Intl.DateTimeFormat("vi-VN", {
    weekday: "long",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    timeZone: config.timezoneId
  }).format(target || new Date());

  const lines = [
    "📋 Chi tiết lịch làm việc",
    `Ngày: ${targetLabel}`,
    `Kiểm tra lúc: ${checkedAt}`,
    "",
    `Loại lịch: ${entry?.type || "Chưa rõ"}`,
    `Ca: ${entry?.shift || "Chưa rõ"}`,
    `Mã PYC/Ticket: ${entry?.ticket || "Không có"}`,
    `Sản phẩm/Dịch vụ: ${entry?.product || "Không có"}`,
    `Khách hàng/Cửa hàng: ${entry?.customer || "Không có"}`,
    `Trạng thái: ${entry?.status || "Chưa rõ"}`,
    `Người phụ trách: ${entry?.owner || "duc.dao"}`,
    `Thời gian: ${entry?.time || "Theo ô lịch Hermes"}`,
    `Ghi chú: ${entry?.note || "Không có"}`,
    `Link lịch: ${entry?.links?.length ? entry.links.join("\n") : "Không có"}`,
    "",
    "Tóm tắt:",
    entry?.text || "Không có dữ liệu chi tiết."
  ];
  return lines.join("\n");
}

export function formatWorkScheduleSummaryLine(entry) {
  const main = entry?.type || "Lịch làm việc";
  const extra = [entry?.shift, entry?.ticket, entry?.status]
    .filter(Boolean)
    .join(" — ");
  return extra ? `${main} — ${extra}` : main;
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
    `📅 Lịch ngày ${targetLabel}`,
    `Kiểm tra lúc: ${checkedAt}`,
    ""
  ];

  if (!result.entries?.length) {
    lines.push("Không có lịch.");
    return lines.join("\n");
  }

  lines.push(`Có ${result.entries.length} lịch:`);
  const grouped = new Map();
  for (const entry of result.entries) {
    const key = entry.type || "Lịch làm việc";
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(entry);
  }
  let index = 1;
  for (const [type, entries] of grouped.entries()) {
    if (index > 20) break;
    lines.push(`\n${type}:`);
    for (const entry of entries) {
      if (index > 20) break;
      const linkHint = entry.links?.length ? " 🔗" : "";
      lines.push(`${index}. ${formatWorkScheduleSummaryLine(entry)}${linkHint}`);
      index += 1;
    }
  }
  if (result.entries.length > 20) {
    lines.push(`... và ${result.entries.length - 20} lịch nữa.`);
  }
  lines.push("");
  lines.push("Bấm vào từng lịch bên dưới để xem chi tiết công việc.");
  return lines.join("\n");
}

export async function getWorkScheduleByDay({ username, password, date = new Date(), storageState = null }) {
  if (!config.hermesLoginUrl) {
    return { ok: false, message: "Chua cau hinh HERMES_LOGIN_URL." };
  }

  if (storageState) {
    const session = await createHermesBrowserContext(storageState);
    try {
      const result = await readScheduleFromLoggedInPage(session.page, session.apiResponses, date);
      if (result.ok) {
        return {
          ...result,
          reusedSession: true,
          storageState: await session.context.storageState().catch(() => storageState)
        };
      }
      if (!result.sessionExpired) {
        return result;
      }
    } catch (error) {
      // Stored cookies can be stale/corrupt. Fall through to full login below.
    } finally {
      await session.browser.close().catch(() => {});
    }
  }

  const login = await loginHermesPage({ username, password });
  if (!login.ok) {
    return { ...login, sessionExpired: Boolean(storageState) || login.otpRequired };
  }

  try {
    const result = await readScheduleFromLoggedInPage(login.page, login.apiResponses, date);
    return {
      ...result,
      storageState: result.ok ? await login.context.storageState().catch(() => null) : null
    };
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

    const result = await readScheduleFromLoggedInPage(page, session.apiResponses || [], date);
    return {
      ...result,
      storageState: result.ok ? await session.context.storageState().catch(() => null) : null
    };
  } catch (error) {
    return { ok: false, message: error.message || "Khong xac nhan duoc OTP Hermes." };
  } finally {
    await closeActiveHermesSession();
  }
}

export async function cancelHermesOtpSession() {
  await closeActiveHermesSession();
}
