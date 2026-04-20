import { mkdir } from "node:fs/promises";
import path from "node:path";

import { chromium, request as playwrightRequest } from "playwright";

import { config } from "./config.js";

const JOB_TRAN_ID = "CHECK_IN_OUT_MAP";
const reverseGeocodeCache = new Map();

function actionToType(action) {
  return action === "checkout" ? "out" : "in";
}

function resolveGeo(geo) {
  return geo || config.geo || null;
}

function formatGeoFallbackAddress(geo) {
  return `${geo.latitude}, ${geo.longitude}`;
}

async function resolveGeoAddress(geo) {
  if (!geo) {
    return "";
  }

  if (typeof geo.address === "string" && geo.address.trim()) {
    return geo.address.trim();
  }

  const cacheKey = `${Number(geo.latitude).toFixed(6)},${Number(geo.longitude).toFixed(6)}`;
  const cached = reverseGeocodeCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  const fallbackAddress = formatGeoFallbackAddress(geo);
  const url = new URL("https://nominatim.openstreetmap.org/reverse");
  url.searchParams.set("format", "jsonv2");
  url.searchParams.set("lat", String(geo.latitude));
  url.searchParams.set("lon", String(geo.longitude));
  url.searchParams.set("zoom", "18");
  url.searchParams.set("addressdetails", "0");

  try {
    const response = await fetch(url, {
      headers: {
        "accept-language": config.locale,
        "user-agent": `ihr-telegram-bot/0.1 (${config.machineName})`
      },
      signal: AbortSignal.timeout(config.timeoutMs)
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const payload = await response.json();
    const address = payload?.display_name?.trim();
    if (!address) {
      throw new Error("Empty display_name");
    }

    reverseGeocodeCache.set(cacheKey, address);
    return address;
  } catch (error) {
    console.warn(`Reverse geocode failed for ${cacheKey}: ${error.message}`);
    return fallbackAddress;
  }
}

function createBrowserContextOptions(geo) {
  const options = {
    ignoreHTTPSErrors: true,
    locale: config.locale,
    timezoneId: config.timezoneId,
    viewport: { width: 1365, height: 900 }
  };

  if (geo) {
    options.permissions = ["geolocation"];
    options.geolocation = geo;
  }

  return options;
}

async function ensureArtifactsDir() {
  const artifactsDir = path.resolve("artifacts");
  await mkdir(artifactsDir, { recursive: true });
  return artifactsDir;
}

function xhrHeaders() {
  return {
    "x-requested-with": "XMLHttpRequest",
    "accept-language": config.locale
  };
}

async function parseResponse(response) {
  const text = await response.text();
  let data = null;

  try {
    data = JSON.parse(text);
  } catch {
    data = null;
  }

  return { text, data };
}

function stripHtml(text) {
  return String(text || "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function summarizeHttpProbeError(status, text) {
  const cleaned = stripHtml(text);
  if (cleaned) {
    return `Khong mo duoc IHR: ${cleaned}`;
  }
  return `Khong mo duoc IHR: HTTP ${status}`;
}

function summarizeError(label, responseText, status) {
  const cleaned = stripHtml(responseText);
  if (cleaned) {
    return `${label} that bai: ${cleaned}`;
  }
  return `${label} that bai: HTTP ${status}`;
}

function getManagerRow(managerPayload) {
  return managerPayload?.HR_EMPLOYEE_ORGANIZATION?.[0] || null;
}

function getCheckEmployeeId(managerPayload) {
  return (
    getManagerRow(managerPayload)?.EMPLOYEE_ID_CHECK ||
    managerPayload?.HR_EMPLOYEE_INFO_CHECK?.[0]?.EMPLOYEE_ID ||
    ""
  );
}

function getApprovedEmployeeId(managerPayload) {
  return (
    getManagerRow(managerPayload)?.EMPLOYEE_ID_APPROVED ||
    managerPayload?.HR_EMPLOYEE_INFO_APPROVED?.[0]?.EMPLOYEE_ID ||
    ""
  );
}

function buildDateFields({ managerRow, addRow }) {
  const dateCheckRaw = addRow?.DATE_CHECK || managerRow?.DATE_CHECK || new Date().toISOString();
  const dateCheck = String(dateCheckRaw).slice(0, 10);
  const timeCheckString =
    addRow?.TIME_CHECK_STRING ||
    managerRow?.TIME_CHECK_STRING ||
    new Intl.DateTimeFormat("en-GB", {
      timeZone: config.timezoneId,
      hour: "2-digit",
      minute: "2-digit",
      hour12: false
    }).format(new Date());

  return {
    dateCheck,
    timeCheck: `${dateCheck} ${timeCheckString}`
  };
}

export function buildAttendanceMultipart({
  managerPayload,
  addRow,
  requestGeo,
  resolvedAddress,
  reason,
  action,
  adjMinute
}) {
  const managerRow = getManagerRow(managerPayload);
  const checkType = actionToType(action);
  const { dateCheck, timeCheck } = buildDateFields({ managerRow, addRow });

  return {
    POSITION_ID: String(managerRow?.POSITION_ID || ""),
    IS_ONLINE: "true",
    EMPLOYEE_ID: String(managerRow?.EMPLOYEE_ID || ""),
    CHECK_TYPE: checkType,
    PR_ORGANIZATION_ID: String(managerRow?.PR_ORGANIZATION_ID || ""),
    MAP_X: String(requestGeo.latitude),
    MAP_Y: String(requestGeo.longitude),
    MAP_Z: "0",
    ADRRESS_MAP: resolvedAddress,
    CHECK_COMMENT: reason,
    EMPLOYEE_ID_CHECK: String(getCheckEmployeeId(managerPayload)),
    EMPLOYEE_ID_APPROVED: String(getApprovedEmployeeId(managerPayload)),
    TIME_CHECK: timeCheck,
    DATE_CHECK: dateCheck,
    ADJ_MINUTE: String(adjMinute ?? addRow?.ADJ_MINUTE ?? managerRow?.ADJ_MINUTE ?? 0),
    JOB_TRAN_ID: JOB_TRAN_ID,
    pr_key: String(addRow.PR_KEY)
  };
}

async function loginHttp(api, { username, password }) {
  const response = await api.post("/Login/CheckUserLogin/", {
    form: {
      UserId: username,
      Password: password,
      Language: config.locale.toLowerCase().startsWith("vi") ? "vi" : "en"
    },
    headers: xhrHeaders(),
    timeout: config.timeoutMs
  });

  const { data, text } = await parseResponse(response);
  if (!response.ok()) {
    throw new Error(summarizeError("Dang nhap", text, response.status()));
  }
  if (!data || Number(data.EXCEPTION_ID) !== 0) {
    throw new Error(data?.EXCEPTION_MESSAGE || "Dang nhap that bai");
  }
}

async function getJson(api, url, params = undefined) {
  const response = await api.get(url, {
    params,
    headers: xhrHeaders(),
    timeout: config.timeoutMs
  });
  const { data, text } = await parseResponse(response);
  if (!response.ok()) {
    throw new Error(summarizeError(`GET ${url}`, text, response.status()));
  }
  return data;
}

async function postMultipart(api, url, multipart) {
  const response = await api.post(url, {
    multipart,
    headers: xhrHeaders(),
    timeout: config.timeoutMs
  });
  const { data, text } = await parseResponse(response);
  if (!response.ok()) {
    throw new Error(summarizeError(`POST ${url}`, text, response.status()));
  }
  return { data, text };
}

async function submitAttendanceHttp({ username, password, reason, action, geo, adjMinute }) {
  const requestGeo = resolveGeo(geo);
  if (!requestGeo) {
    return {
      ok: false,
      message:
        "Chua co vi tri de gui len IHR. Hay gui location qua Telegram hoac khai bao IHR_GEO_LAT/IHR_GEO_LNG trong file .env."
    };
  }

  const api = await playwrightRequest.newContext({
    baseURL: config.baseUrl,
    ignoreHTTPSErrors: true,
    extraHTTPHeaders: {
      "accept-language": config.locale
    }
  });

  try {
    const resolvedAddress = await resolveGeoAddress(requestGeo);
    await loginHttp(api, { username, password });

    const landing = await api.get(config.checkInUrl, { timeout: config.timeoutMs });
    if (!landing.ok()) {
      const landingText = await landing.text();
      throw new Error(summarizeError("Mo man hinh cham cong", landingText, landing.status()));
    }

    const managerPayload = await getJson(api, "/Share/GetManager", { id: JOB_TRAN_ID });
    const managerRow = getManagerRow(managerPayload);
    if (!managerRow) {
      throw new Error("Khong lay duoc thong tin nhan vien/bo phan tu IHR.");
    }

    const checkType = actionToType(action);
    const existingRows = await getJson(api, "/Hr_Time_Checkinout_Map/getcheck", { type: checkType });
    if (Array.isArray(existingRows) && existingRows.length > 0) {
      return {
        ok: false,
        message:
          action === "checkout"
            ? "IHR dang bao da ton tai ban ghi Check Out cho thao tac nay. Bot chua tu dong ghi de."
            : "IHR dang bao da ton tai ban ghi Check In cho thao tac nay. Bot chua tu dong ghi de."
      };
    }

    const addRowPayload = await getJson(api, "/Hr_Time_Checkinout_Map/AddRowNew");
    const addRow = addRowPayload?.[0];
    if (!addRow?.PR_KEY) {
      throw new Error("Khong tao duoc ban ghi tam tu IHR (AddRowNew).");
    }

    const multipart = buildAttendanceMultipart({
      managerPayload,
      addRow,
      requestGeo,
      resolvedAddress,
      reason,
      action,
      adjMinute
    });

    const { data, text } = await postMultipart(api, "/Hr_Time_Checkinout_Map/UpdateData", multipart);

    if (Array.isArray(data)) {
      if (data[0] === "Errors") {
        return {
          ok: false,
          message: stripHtml(data[1] || "IHR tra ve loi khong ro noi dung.")
        };
      }
      return {
        ok: true,
        message: stripHtml(data[1] || text || "IHR da nhan thao tac.")
      };
    }

    return {
      ok: true,
      message: stripHtml(text || "IHR da nhan thao tac.")
    };
  } finally {
    await api.dispose();
  }
}

async function attachDialogAutoAccept(page) {
  page.on("dialog", async (dialog) => {
    try {
      await dialog.accept();
    } catch (error) {
      console.error("Failed to accept dialog:", error.message);
    }
  });
}

async function readText(locator) {
  try {
    const text = await locator.textContent({ timeout: 1000 });
    return text?.trim() || "";
  } catch {
    return "";
  }
}

async function loginBrowser(page, { username, password }) {
  await page.goto(config.loginUrl, { waitUntil: "domcontentloaded", timeout: config.timeoutMs });
  await page.locator("#txtuserid").fill(username);
  await page.locator("#txtpassword").fill(password);
  await page.locator("#btnlogin").click();

  await page.waitForLoadState("networkidle", { timeout: config.timeoutMs }).catch(() => { });

  const loginError = await readText(page.locator("#lblMessage"));
  if (page.url().includes("/System/Login") && loginError) {
    throw new Error(`Dang nhap that bai: ${loginError}`);
  }
}

async function openCheckInPageBrowser(page) {
  await page.goto(config.checkInUrl, { waitUntil: "domcontentloaded", timeout: config.timeoutMs });
  await page.waitForLoadState("networkidle", { timeout: config.timeoutMs }).catch(() => { });

  if (page.url().includes("/System/Login")) {
    throw new Error("Khong giu duoc session sau khi dang nhap. Hay kiem tra VPN hoac tai khoan IHR.");
  }
}

async function fillReasonBrowser(page, reason) {
  const noteArea = page.locator("textarea").first();
  await noteArea.waitFor({ state: "visible", timeout: config.timeoutMs });
  await noteArea.fill(reason);
}

async function clickAttendanceButtonBrowser(page, action) {
  const selectors = action === "checkout"
    ? ["#btnChekOut", "a:has-text('Check Out')", "button:has-text('Check Out')"]
    : ["#btnChekIn", "a:has-text('Check In')", "button:has-text('Check In')"];

  let button = null;
  for (const selector of selectors) {
    const candidate = page.locator(selector).first();
    const isVisible = await candidate.isVisible().catch(() => false);
    if (isVisible) {
      button = candidate;
      break;
    }
  }

  if (!button) {
    throw new Error(`Khong tim thay nut ${action === "checkout" ? "Check Out" : "Check In"} tren giao dien IHR.`);
  }

  await button.waitFor({ state: "visible", timeout: config.timeoutMs });
  await button.click();
  await page.waitForLoadState("networkidle", { timeout: 5000 }).catch(() => { });
}

async function clickSaveButtonBrowser(page) {
  const saveButton = page.locator("#btnSaveAs");
  await saveButton.waitFor({ state: "visible", timeout: config.timeoutMs });
  await saveButton.click();
  await page.waitForLoadState("networkidle", { timeout: 5000 }).catch(() => { });
}

async function inferResultBrowser(page, action) {
  await page.waitForTimeout(2500);

  const messageCandidates = [
    page.locator(".k-notification").first(),
    page.locator(".toast").first(),
    page.locator(".swal2-popup").first(),
    page.locator(".alert").first(),
    page.locator("#lblMessage").first()
  ];

  for (const locator of messageCandidates) {
    const text = await readText(locator);
    if (text) {
      return text;
    }
  }

  return action === "checkout"
    ? "Da bam nut Check Out. Neu IHR khong bao loi thi kha nang cao la da gui thanh cong."
    : "Da bam nut Check In. Neu IHR khong bao loi thi kha nang cao la da gui thanh cong.";
}

async function takeFailureScreenshot(page, prefix) {
  const artifactsDir = await ensureArtifactsDir();
  const filename = `${prefix}-${Date.now()}.png`;
  const target = path.join(artifactsDir, filename);
  try {
    await page.screenshot({ path: target, fullPage: true });
    return target;
  } catch {
    return null;
  }
}

async function submitAttendanceBrowser({ username, password, reason, action, geo }) {
  const browser = await chromium.launch({ headless: config.headless });
  const context = await browser.newContext(createBrowserContextOptions(resolveGeo(geo)));
  const page = await context.newPage();
  page.setDefaultTimeout(config.timeoutMs);

  await attachDialogAutoAccept(page);

  try {
    await loginBrowser(page, { username, password });
    await openCheckInPageBrowser(page);
    await fillReasonBrowser(page, reason);
    await clickAttendanceButtonBrowser(page, action);
    await clickSaveButtonBrowser(page);
    const resultMessage = await inferResultBrowser(page, action);
    await browser.close();
    return {
      ok: true,
      message: resultMessage
    };
  } catch (error) {
    const screenshotPath = await takeFailureScreenshot(page, action);
    await browser.close();
    return {
      ok: false,
      message: error.message,
      screenshotPath
    };
  }
}

export async function submitAttendance(options) {
  if (config.transport === "browser") {
    return submitAttendanceBrowser(options);
  }
  return submitAttendanceHttp(options);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function submitAttendanceWithRetry(options, maxRetries = 2, delayMs = 3000) {
  let lastResult = null;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const result = await submitAttendance(options);
    if (result.ok) return result;
    lastResult = result;
    if (attempt < maxRetries) {
      await sleep(delayMs);
    }
  }
  return lastResult;
}

export async function probeIhrAvailability() {
  const api = await playwrightRequest.newContext({
    ignoreHTTPSErrors: true,
    extraHTTPHeaders: {
      "accept-language": config.locale
    }
  });

  try {
    const response = await api.get(config.loginUrl, {
      timeout: config.timeoutMs
    });

    if (!response.ok()) {
      const text = await response.text();
      return {
        ok: false,
        message: summarizeHttpProbeError(response.status(), text)
      };
    }

    return {
      ok: true,
      message: "Mo duoc man hinh dang nhap IHR."
    };
  } catch (error) {
    return {
      ok: false,
      message: error.message || "Khong ket noi duoc toi IHR."
    };
  } finally {
    await api.dispose();
  }
}
