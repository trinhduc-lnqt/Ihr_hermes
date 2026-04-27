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
  "input[type='email']",
  "input[formcontrolname='email']",
  "input[formcontrolname='username']",
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

  try {
    await page.goto(config.hermesLoginUrl, { waitUntil: "domcontentloaded", timeout: config.timeoutMs });
    await page.waitForSelector("input", { state: "visible", timeout: config.timeoutMs });
    await page.waitForTimeout(500);
    await fillFirstVisible(page, USERNAME_SELECTORS, username, "tai khoan");
    await fillFirstVisible(page, PASSWORD_SELECTORS, password, "mat khau");
    await clickFirstVisible(page, SUBMIT_SELECTORS);
    await page.waitForLoadState("networkidle", { timeout: config.timeoutMs }).catch(() => {});
    await page.waitForTimeout(1500);

    const errorText = await readFirstText(page, ERROR_SELECTORS);
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
    await fillFirstVisible(page, OTP_SELECTORS, otp, "OTP");
    await clickFirstVisible(page, OTP_SUBMIT_SELECTORS);
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

export async function cancelHermesOtpSession() {
  await closeActiveHermesSession();
}
