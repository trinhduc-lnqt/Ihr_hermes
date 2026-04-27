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
  "input[type='text']"
];

const PASSWORD_SELECTORS = [
  "#txtpassword",
  "#txtPassword",
  "#password",
  "#Password",
  "input[name='Password']",
  "input[name='password']",
  "input[type='password']"
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

async function fillFirstVisible(page, selectors, value, label) {
  for (const selector of selectors) {
    const locator = page.locator(selector).first();
    const visible = await locator.isVisible().catch(() => false);
    if (!visible) {
      continue;
    }
    await locator.fill(value);
    return selector;
  }
  throw new Error(`Khong tim thay o nhap ${label} tren trang Hermes.`);
}

async function clickFirstVisible(page, selectors) {
  for (const selector of selectors) {
    const locator = page.locator(selector).first();
    const visible = await locator.isVisible().catch(() => false);
    if (!visible) {
      continue;
    }
    await locator.click();
    return selector;
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

export async function validateHermesLogin({ username, password }) {
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

  try {
    await page.goto(config.hermesLoginUrl, { waitUntil: "domcontentloaded", timeout: config.timeoutMs });
    await fillFirstVisible(page, USERNAME_SELECTORS, username, "tai khoan");
    await fillFirstVisible(page, PASSWORD_SELECTORS, password, "mat khau");
    await clickFirstVisible(page, SUBMIT_SELECTORS);
    await page.waitForLoadState("networkidle", { timeout: config.timeoutMs }).catch(() => {});
    await page.waitForTimeout(1000);

    const errorText = await readFirstText(page, [
      "#lblMessage",
      ".validation-summary-errors",
      ".field-validation-error",
      ".alert-danger",
      ".toast-error",
      ".k-notification-error",
      "text=/sai|không đúng|khong dung|thất bại|that bai|invalid|incorrect/i"
    ]);

    if (errorText) {
      return { ok: false, message: `Dang nhap Hermes that bai: ${errorText}` };
    }

    const passwordStillVisible = await page.locator("input[type='password']").first().isVisible().catch(() => false);
    const stayedOnLogin = page.url().includes(config.hermesLoginUrl) || /login|dang-?nhap/i.test(page.url());
    if (passwordStillVisible && stayedOnLogin) {
      return { ok: false, message: "Hermes van dung o man hinh dang nhap, kha nang sai tai khoan/mat khau." };
    }

    return { ok: true, message: "Dang nhap Hermes OK." };
  } catch (error) {
    return { ok: false, message: error.message || "Khong test duoc dang nhap Hermes." };
  } finally {
    await browser.close();
  }
}
