import net from "node:net";
import { Markup, Telegraf } from "telegraf";

import { getAllowedTelegramIds, isAuthorizedTelegramId } from "./access.js";
import { assertBotConfig, config } from "./config.js";
import {
  cancelHermesOtpSession,
  formatRequestOrderDetailHtml,
  formatWorkScheduleNoteOnlyDetail,
  formatWorkScheduleResult,
  formatWorkScheduleSummaryLine,
  getRelativeWorkScheduleDate,
  getRequestOrderDetailById,
  getRequestOrderIdFromScheduleEntry,
  getRequestOrderPageUrlFromScheduleEntry,
  getWorkScheduleByDay,
  getKpiSummary,
  parseWorkScheduleDateInput,
  submitHermesOtp,
  submitHermesOtpAndGetWorkSchedule,
  validateHermesLogin
} from "./hermesClient.js";
import {
  clearHermesSession,
  deleteHermesAccount,
  getHermesAccount,
  saveHermesAccount,
  saveHermesSession
} from "./store.js";

assertBotConfig();

const bot = new Telegraf(config.telegramToken);
const pendingActions = new Map();
const workScheduleCache = new Map();
const startedAt = new Date();
let instanceLockServer = null;
let queue = Promise.resolve();

const telegramCommands = [
  { command: "start", description: "Mở menu Hermes" },
  { command: "lich", description: "Xem lịch làm việc" },
  { command: "kpi", description: "Xem KPI tháng và năm" },
  { command: "sethermes", description: "Lưu tài khoản Hermes" },
  { command: "deletehermes", description: "Xóa tài khoản Hermes" },
  { command: "id", description: "Xem Telegram ID" },
  { command: "cancel", description: "Hủy thao tác đang đợi" }
];

function enqueue(task) {
  const run = queue.then(task, task);
  queue = run.catch(() => {});
  return run;
}

function isPrivateChat(ctx) {
  return ctx.chat?.type === "private";
}

function getTelegramId(ctx) {
  return String(ctx.from?.id || "");
}

function isStartLikeUpdate(ctx) {
  const text = ctx.message?.text?.trim() || "";
  return text === "/start" || text.startsWith("/start@") || text === "/id" || text.startsWith("/id@");
}

function buildUnauthorizedText(ctx) {
  const telegramId = getTelegramId(ctx);
  return [
    "Telegram ID của Sếp:",
    telegramId || "(không xác định)",
    "",
    "Bot lịch Hermes đang khoá.",
    "Gửi ID này cho admin để được thêm vào danh sách cho phép."
  ].join("\n");
}

async function isAllowedUser(ctx) {
  if (isStartLikeUpdate(ctx)) {
    return true;
  }
  return isAuthorizedTelegramId(getTelegramId(ctx));
}

function keyboard() {
  return Markup.inlineKeyboard([
    [
      Markup.button.callback("⬅️ Hôm qua", "action:hermes_work_offset:-1"),
      Markup.button.callback("📅 Hôm nay", "action:hermes_work_offset:0"),
      Markup.button.callback("➡️ Ngày mai", "action:hermes_work_offset:1")
    ],
    [Markup.button.callback("🗓️ Lịch cả tuần", "action:hermes_work_week")],
    [Markup.button.callback("🎯 KPI tháng/năm", "action:hermes_kpi")],
    [Markup.button.callback("🔐 Tài khoản Hermes", "action:hermes_account"), Markup.button.callback("🗑️ Xoá TK Hermes", "action:delete_hermes")],
    [Markup.button.callback("👤 Check user hiện tại", "action:hermes_current_user")]
  ]);
}

function compactButtonLabel(text, maxLength = 42) {
  const value = String(text || "").replace(/\s+/g, " ").trim();
  return value.length > maxLength ? `${value.slice(0, maxLength - 1)}…` : value;
}

function firstValidScheduleLink(entry) {
  const requestOrderPageUrl = getRequestOrderPageUrlFromScheduleEntry(entry);
  if (requestOrderPageUrl) return requestOrderPageUrl;
  const requestOrderId = getRequestOrderIdFromScheduleEntry(entry);
  if (!requestOrderId) return "";
  return [entry?.link, ...(entry?.links || [])]
    .filter(Boolean)
    .find((link) => /^https?:\/\//i.test(String(link))) || "";
}

function workScheduleKeyboard(result, cacheKey) {
  const rows = [];
  const entries = result?.entries || [];
  for (let index = 0; index < Math.min(entries.length, 10); index += 1) {
    rows.push([Markup.button.callback(`📄 Chi tiết lịch ${index + 1}`, `action:hermes_work_detail:${cacheKey}:${index}`)]);
  }
  rows.push([
    Markup.button.callback("⬅️ Hôm qua", `action:hermes_work_date:${result.targetDate}:-1`),
    Markup.button.callback("➡️ Ngày mai", `action:hermes_work_date:${result.targetDate}:1`),
    Markup.button.callback("📆 Chọn ngày khác", "action:hermes_work_other")
  ]);
  rows.push([Markup.button.callback("🏠 Về menu chính", "action:menu")]);
  return Markup.inlineKeyboard(rows);
}

function workScheduleDetailKeyboard(result, cacheKey, entry = null) {
  const rows = [];
  const link = firstValidScheduleLink(entry);
  if (link) {
    rows.push([Markup.button.url("🔗 Mở trên Hermes", link)]);
  }
  rows.push([
    Markup.button.callback("📋 Danh sách", `action:hermes_work_list:${cacheKey}`),
    Markup.button.callback("📆 Ngày khác", "action:hermes_work_other"),
    Markup.button.callback("🏠 Menu", "action:menu")
  ]);
  return Markup.inlineKeyboard(rows);
}

function formatDateTime(date) {
  return new Intl.DateTimeFormat("vi-VN", {
    dateStyle: "short",
    timeStyle: "medium",
    timeZone: config.timezoneId
  }).format(date);
}

function formatDuration(durationMs) {
  const totalSeconds = Math.max(0, Math.floor(durationMs / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return [hours ? `${hours}h` : "", minutes || hours ? `${minutes}m` : "", `${seconds}s`].filter(Boolean).join(" ");
}

function formatHermesAccountStatus(account) {
  if (!account?.hermesUsername) {
    return [
      "Chưa lưu tài khoản Hermes.",
      "Gửi /sethermes để thêm tài khoản."
    ].join("\n");
  }
  return [
    `User Hermes đang lưu: ${account.hermesUsername}`,
    `Telegram: ${account.telegramName || "(không có tên)"}${account.telegramUsername ? ` (@${account.telegramUsername})` : ""}`,
    `Chat ID: ${account.chatId || "(không có)"}`,
    `Cập nhật: ${account.updatedAt ? formatDateTime(new Date(account.updatedAt)) : "không rõ"}`,
    `Session Hermes: ${account.hermesSession ? "đang có" : "chưa có"}`
  ].join("\n");
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function formatWeekScheduleEntryHtml(entry, index) {
  const summary = String(formatWorkScheduleSummaryLine(entry) || "").trim();
  const link = firstValidScheduleLink(entry);
  const ticket = String(entry?.ticket || "").trim();

  if (!link || !ticket || !summary.includes(ticket)) {
    return `${index}. ${escapeHtml(summary)}`;
  }

  const linkedTicket = `<a href="${escapeHtml(link)}">${escapeHtml(ticket)}</a>`;
  return `${index}. ${escapeHtml(summary).replace(escapeHtml(ticket), linkedTicket)}`;
}

function formatWeekScheduleResult(results, checkedAt = new Date()) {
  const checkedLabel = new Intl.DateTimeFormat("vi-VN", {
    dateStyle: "short",
    timeStyle: "medium",
    timeZone: config.timezoneId
  }).format(checkedAt);
  const lines = [
    "🗓️ <b>Lịch cả tuần</b>",
    `⏱ <b>Kiểm tra lúc:</b> ${escapeHtml(checkedLabel)}`,
    ""
  ];

  for (const result of results) {
    const target = parseWorkScheduleDateInput(result.targetDate) || new Date();
    const label = new Intl.DateTimeFormat("vi-VN", {
      weekday: "long",
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      timeZone: config.timezoneId
    }).format(target);
    lines.push(`📅 <b>${escapeHtml(label)}</b>`);
    if (!result.entries?.length) {
      lines.push("- Không có lịch");
      lines.push("");
      continue;
    }
    for (const [index, entry] of result.entries.slice(0, 10).entries()) {
      lines.push(formatWeekScheduleEntryHtml(entry, index + 1));
    }
    if (result.entries.length > 10) {
      lines.push(`... và ${escapeHtml(result.entries.length - 10)} lịch nữa`);
    }
    lines.push("");
  }

  return lines.join("\n");
}

const START_QUOTES = [
  [
    "Hôm nay mây kéo lưng trời,",
    "lịch của Sếp để em ngồi canh cho."
  ],
  [
    "Ngày dài việc có thể đông,",
    "nhưng đúng ngày đúng lịch thì em không để sai."
  ],
  [
    "Sáng ra mở lịch thong dong,",
    "phiếu nào đúng việc em lôi ra liền."
  ],
  [
    "Việc nhiều chưa chắc đã căng,",
    "có em giữ lịch, đỡ nhằn hơn kha khá."
  ],
  [
    "Lịch kia nếu có đổi dời,",
    "em soi đúng chỗ chứ không lôi lịch ma."
  ],
  [
    "Một lần bấm, một lần xem,",
    "đúng ngày đúng phiếu em đem ra liền."
  ],
  [
    "Gió ngoài kia thích lang thang,",
    "còn em thì thích giữ hàng lịch cho Sếp."
  ],
  [
    "Việc chạy ngược, lịch đừng loạn,",
    "để em gom lại cho gọn từng ngày."
  ],
  [
    "Bấm vào một nhịp là xem,",
    "lịch đâu phiếu đó em đem tới liền."
  ]
];

function pickStartQuote() {
  const index = Math.floor(Math.random() * START_QUOTES.length);
  return START_QUOTES[index] || START_QUOTES[0];
}

function helpText(telegramId) {
  const quote = pickStartQuote();
  return [
    "<b>Hermes Bot</b> • lịch làm việc cho Sếp",
    "",
    ...quote,
    "",
    "<b>Xem nhanh</b>",
    "Hôm qua • Hôm nay • Ngày mai • Cả tuần",
    "",
    "<b>Lệnh dùng nhanh</b>",
    "<code>/lich</code> • <code>/lich mai</code> • <code>/lich 28/04</code>",
    "<code>/sethermes</code> để lưu tài khoản",
    "",
    `ID: <code>${telegramId}</code>`
  ].join("\n");
}

function buildStatusText() {
  return [
    "Bot lịch Hermes: online",
    `Bắt đầu: ${formatDateTime(startedAt)}`,
    `Uptime: ${formatDuration(Date.now() - startedAt.getTime())}`
  ].join("\n");
}

async function notifyAllowedUsers(message) {
  const ids = await getAllowedTelegramIds();
  for (const telegramId of ids) {
    try {
      await bot.telegram.sendMessage(telegramId, message);
    } catch (error) {
      console.warn(`Cannot send Telegram notification to ${telegramId}:`, error.message);
    }
  }
}

async function syncTelegramCommandMenu() {
  try {
    await bot.telegram.setMyCommands(telegramCommands);
    await bot.telegram.setMyCommands(telegramCommands, { scope: { type: "all_private_chats" } });
    await bot.telegram.setChatMenuButton({ menuButton: { type: "commands" } });
  } catch (error) {
    console.error("Cannot sync Telegram command menu:", error);
  }
}

async function acquireInstanceLock() {
  await new Promise((resolve, reject) => {
    const server = net.createServer();
    server.on("error", (error) => {
      if (error.code === "EADDRINUSE") {
        reject(new Error(`Another Hermes schedule bot instance is already running on port ${config.lockPort}.`));
        return;
      }
      reject(error);
    });
    server.listen(config.lockPort, "127.0.0.1", () => {
      instanceLockServer = server;
      resolve();
    });
  });
}

async function releaseInstanceLock() {
  if (!instanceLockServer) return;
  await new Promise((resolve) => instanceLockServer.close(() => resolve()));
  instanceLockServer = null;
}

async function guard(ctx, next) {
  if (!isPrivateChat(ctx)) {
    if (ctx.callbackQuery) await ctx.answerCbQuery("Bot chỉ hoạt động trong chat private.");
    if (ctx.reply) await ctx.reply("Bot chỉ hoạt động trong chat private. Mở chat riêng với bot nhé Sếp.");
    return;
  }
  if (isStartLikeUpdate(ctx)) return next();
  if (!(await isAllowedUser(ctx))) {
    if (ctx.callbackQuery) await ctx.answerCbQuery("Telegram ID này chưa được cấp quyền.");
    if (ctx.reply) await ctx.reply(buildUnauthorizedText(ctx), Markup.removeKeyboard());
    return;
  }
  return next();
}

function parseScheduleCommandDate(text) {
  const raw = String(text || "").trim();
  const arg = raw.split(/\s+/).slice(1).join(" ");
  return parseWorkScheduleDateInput(arg);
}

function getWorkScheduleCacheKey(chatId, targetDate) {
  return `${chatId}:${targetDate}`;
}

function rememberWorkSchedule(ctx, result) {
  const key = getWorkScheduleCacheKey(ctx.chat.id, result.targetDate);
  workScheduleCache.set(key, { result, savedAt: Date.now() });
  for (const [cacheKey, value] of workScheduleCache.entries()) {
    if (Date.now() - value.savedAt > 30 * 60 * 1000) workScheduleCache.delete(cacheKey);
  }
  return key;
}

async function askWorkScheduleOtherDate(ctx) {
  pendingActions.set(ctx.chat.id, { stage: "hermes_schedule_date" });
  await ctx.reply([
    "📆 <b>Chọn ngày cần xem lịch</b>",
    "",
    "Sếp chỉ cần gửi một trong các dạng sau:",
    "• <code>28/04</code>",
    "• <code>28/04/2026</code>",
    "• <code>hôm nay</code>",
    "• <code>mai</code>",
    "",
    "Muốn huỷ thì gõ <code>/cancel</code>."
  ].join("\n"), {
    parse_mode: "HTML"
  });
}

async function getHermesAccountOrReply(ctx) {
  const account = await getHermesAccount({ secret: config.botSecretKey, chatId: ctx.chat.id });
  if (!account?.hermesUsername || !account?.hermesPassword) {
    await ctx.reply("Chưa có tài khoản Hermes. Gửi /sethermes để lưu trước nhé Sếp.", keyboard());
    return null;
  }
  return account;
}

async function showWorkSchedule(ctx, date = new Date()) {
  const account = await getHermesAccountOrReply(ctx);
  if (!account) return;

  await ctx.reply("Đang kiểm tra lịch làm việc Hermes...");
  const result = await enqueue(() => getWorkScheduleByDay({
    username: account.hermesUsername,
    password: account.hermesPassword,
    date,
    storageState: account.hermesSession || null
  }));

  if (result.sessionExpired) await clearHermesSession(ctx.chat.id);
  if (result.otpRequired) {
    pendingActions.set(ctx.chat.id, { stage: "hermes_schedule_otp", date });
    await ctx.reply("Hermes yêu cầu OTP. Sếp gửi mã OTP mới nhất, em sẽ xác nhận rồi lưu phiên. /cancel để huỷ.");
    return;
  }
  if (!result.ok) {
    await ctx.reply(`Không lấy được lịch làm việc.\n${String(result.message || "Lỗi không xác định").slice(0, 700)}`, keyboard());
    return;
  }
  if (result.storageState) {
    await saveHermesSession({ secret: config.botSecretKey, chatId: ctx.chat.id, storageState: result.storageState });
  }
  const cacheKey = rememberWorkSchedule(ctx, result);
  await ctx.reply(formatWorkScheduleResult(result), {
    parse_mode: "HTML",
    ...workScheduleKeyboard(result, cacheKey)
  });
}

function kpiKeyboard(months = []) {
  const rows = [];
  const monthButtons = months.slice(0, 12).map((month) =>
    Markup.button.callback(`📊 ${month.replace("_", "/")}`, `action:hermes_kpi_month:${month}`)
  );

  for (let i = 0; i < monthButtons.length; i += 3) {
    rows.push(monthButtons.slice(i, i + 3));
  }

  rows.push([Markup.button.callback("🏠 Về menu chính", "action:menu")]);
  return Markup.inlineKeyboard(rows);
}

function formatPercentLine(label, ratio) {
  const percent = Number(ratio || 0) * 100;
  return `${label}: <b>${percent.toFixed(2)}%</b>`;
}

function formatKpiBar(label, ratio, icon = "🔋") {
  const percent = Number(ratio || 0) * 100;
  const normalized = Math.max(0, Math.min(percent, 100));
  const total = 18;
  const pointerIndex = Math.max(0, Math.min(total - 1, Math.round((normalized / 100) * (total - 1))));
  const labelWidth = 8;

  let statusIcon = icon;
  if (percent < 80) {
    statusIcon = "🚨";
  } else if (percent < 100) {
    statusIcon = "⚠️";
  } else {
    statusIcon = "✅";
  }

  const barChars = Array.from({ length: total }, (_, index) => {
    if (index < pointerIndex) return "━";
    if (index === pointerIndex) return "⬤";
    return "·";
  }).join("");

  return `${statusIcon} ${padRight(label, labelWidth)} 0 <code>${barChars}</code> 100 <b>${percent.toFixed(2)}%</b>`;
}

function formatMetricValue(value, digits = 2) {
  return Number(value || 0).toFixed(digits);
}

function padRight(value, width) {
  const text = String(value ?? "");
  return text.length >= width ? text.slice(0, width) : text + " ".repeat(width - text.length);
}

function padLeft(value, width) {
  const text = String(value ?? "");
  return text.length >= width ? text.slice(0, width) : " ".repeat(width - text.length) + text;
}

function formatWorkloadTable(item) {
  const rows = [
    ["Triển khai POS (6)", formatMetricValue(item.deployPos)],
    ["Triển khai FABi (6)", formatMetricValue(item.deployFabi)],
    ["Triển khai CRM (3)", formatMetricValue(item.deployCrm)],
    ["Triển khai BK (3)", formatMetricValue(item.deployBk)],
    ["Triển khai Call (3)", formatMetricValue(item.deployCall)],
    ["Triển khai WO (3)", formatMetricValue(item.deployWo)],
    ["Triển khai O2O (3)", formatMetricValue(item.deployO2o)],
    ["Triển khai Hub (1)", formatMetricValue(item.deployHub)],
    ["Triển khai HDDT (1.5)", formatMetricValue(item.deployHddt)],
    ["Triển khai FoodHub (1.5)", formatMetricValue(item.deployFoodHub)],
    ["Triển khai thêm (3)", formatMetricValue(item.deployExtra)],
    ["Onsite TX (1.5)", formatMetricValue(item.onsiteTx)],
    ["Onsite NT (3)", formatMetricValue(item.onsiteNt)],
    ["Bảo trì (3)", formatMetricValue(item.maintenance)],
    ["Support Count", formatMetricValue(item.supportCount)],
    ["Rate AI Avg", formatMetricValue(item.rateAiAvg, 4)]
  ];

  const leftWidth = Math.max(...rows.map(([label]) => String(label).length), "Sản phẩm".length);
  const rightWidth = Math.max(...rows.map(([, value]) => String(value).length), "Chỉ số".length);
  const border = `+-${"-".repeat(leftWidth)}-+-${"-".repeat(rightWidth)}-+`;
  const body = rows.map(([label, value]) => `| ${padRight(label, leftWidth)} | ${padLeft(value, rightWidth)} |`).join("\n");
  return [
    "🧩 <b>Sản lượng / chỉ số</b>",
    `<pre>${border}\n| ${padRight("Sản phẩm", leftWidth)} | ${padLeft("Chỉ số", rightWidth)} |\n${border}\n${body}\n${border}</pre>`
  ].join("\n");
}

function formatKpiMonthTelegramHtml(monthData, item) {
  const monthLabel = String(monthData.month || "").replace("_", "/");
  const kpiSumPercent = Number(item.kpiSum || 0) * 100;
  return [
    `🎯 <b>KPI tháng ${escapeHtml(monthLabel)}</b>`,
    `👤 <b>${escapeHtml(item.support)}</b>`,
    "",
    "📊 <b>KPI</b>",
    formatKpiBar("Hotline", item.hotlinePct, "🎧"),
    "",
    formatKpiBar("Deploy", item.deployPct, "🚀"),
    "",
    formatKpiBar("KPI tổng", item.kpiSum, "🧮"),
    "",
    "💰 <b>Tính lương</b>",
    `• 💵 POINT Thực tế (1): <b>${formatMetricValue(item.pointActual)}</b>`,
    `• 🎁 POINT Bonus (2): <b>${formatMetricValue(item.pointBonus)}</b>`,
    `• 🏆 POINT Tính lương: <b>${formatMetricValue(item.pointSalary)}</b>`,
    "",
    formatWorkloadTable(item)
  ].join("\n");
}

async function showKpiSummary(ctx) {
  await ctx.reply("Đang tải danh sách tháng KPI...");
  const result = await enqueue(() => getKpiSummary());
  if (!result?.ok) {
    await ctx.reply(`Không tải được KPI.\n${String(result?.message || "Lỗi không xác định").slice(0, 700)}`, keyboard());
    return;
  }
  await ctx.reply([
    "🎯 <b>KPI theo tháng</b>",
    "",
    "Theo dõi KPI đều để biết mình đang bứt tốc hay bị hụt hơi trong tháng này.",
    "Chạm đúng tháng cần xem, bot sẽ lấy đúng sheet KPI tương ứng của tháng đó.",
    "",
    "<b>Cách xem:</b>",
    "• Tháng 03/2026 → sheet <code>2026_03</code>",
    "• Tháng 04/2026 → sheet <code>2026_04</code>",
    "",
    "Bên trong sẽ có đủ:",
    "• KPI Deploy",
    "• KPI Hotline",
    "• KPI SUM",
    "• POINT Thực tế, Bonus, Tính lương",
    "",
    "Giữ nhịp tốt từng tháng thì cuối kỳ nhìn KPI mới đã mắt 💪"
  ].join("\n"), {
    parse_mode: "HTML",
    disable_web_page_preview: true,
    ...kpiKeyboard(result.months || [])
  });
}

async function showKpiMonth(ctx, month) {
  const account = await getHermesAccountOrReply(ctx);
  if (!account) return;
  const result = await enqueue(() => getKpiSummary());
  if (!result?.ok) {
    await ctx.reply(`Không tải được KPI.\n${String(result?.message || "Lỗi không xác định").slice(0, 700)}`, keyboard());
    return;
  }
  const monthData = (result.monthly || []).find((item) => item.month === month);
  if (!monthData) {
    await ctx.reply(`Không tìm thấy sheet KPI tháng ${month}.`, keyboard());
    return;
  }
  const hermesUsername = String(account.hermesUsername || "").trim().toLowerCase();
  const item = (monthData.records || []).find((row) => String(row.support || "").trim().toLowerCase() === hermesUsername);
  if (!item) {
    await ctx.reply(`Không tìm thấy KPI của tài khoản ${account.hermesUsername} trong sheet ${month}.`, keyboard());
    return;
  }
  await ctx.reply(formatKpiMonthTelegramHtml(monthData, item), {
    parse_mode: "HTML",
    disable_web_page_preview: true,
    ...kpiKeyboard(result.months || [])
  });
}

async function showWorkScheduleWeek(ctx, date = new Date()) {
  const account = await getHermesAccountOrReply(ctx);
  if (!account) return;

  await ctx.reply("Đang kiểm tra lịch cả tuần Hermes...");
  const results = [];
  let storageState = account.hermesSession || null;

  for (let offset = 0; offset < 7; offset += 1) {
    const targetDate = getRelativeWorkScheduleDate(offset, getRelativeWorkScheduleDate(-(new Date(date).getDay() || 7) + 1, date));
    const result = await enqueue(() => getWorkScheduleByDay({
      username: account.hermesUsername,
      password: account.hermesPassword,
      date: targetDate,
      storageState
    }));

    if (result.sessionExpired) await clearHermesSession(ctx.chat.id);
    if (result.otpRequired) {
      pendingActions.set(ctx.chat.id, { stage: "hermes_schedule_otp", date: targetDate });
      await ctx.reply("Hermes yêu cầu OTP giữa lúc lấy lịch tuần. Sếp gửi mã OTP mới nhất rồi bấm lại giúp em. /cancel để huỷ.");
      return;
    }
    if (!result.ok) {
      await ctx.reply(`Không lấy được lịch tuần.\n${String(result.message || "Lỗi không xác định").slice(0, 700)}`, keyboard());
      return;
    }
    if (result.storageState) {
      storageState = result.storageState;
      await saveHermesSession({ secret: config.botSecretKey, chatId: ctx.chat.id, storageState });
    }
    results.push(result);
  }

  await ctx.reply(formatWeekScheduleResult(results), {
    parse_mode: "HTML",
    ...keyboard()
  });
}

bot.use(guard);

bot.start(async (ctx) => {
  const allowed = await isAllowedUser(ctx);
  if (!allowed) {
    await ctx.reply(buildUnauthorizedText(ctx), Markup.removeKeyboard());
    return;
  }
  await ctx.reply(helpText(ctx.from.id), {
    parse_mode: "HTML",
    disable_web_page_preview: true,
    ...keyboard()
  });
});

bot.command("id", async (ctx) => {
  await ctx.reply(`Telegram ID của Sếp: ${getTelegramId(ctx)}`);
});

bot.command("menu", async (ctx) => {
  await ctx.reply("<b>Menu Hermes</b>", {
    parse_mode: "HTML",
    disable_web_page_preview: true,
    ...keyboard()
  });
});

bot.command("status", async (ctx) => {
  await ctx.reply(buildStatusText(), keyboard());
});

bot.command("cancel", async (ctx) => {
  const pending = pendingActions.get(ctx.chat.id);
  if (pending?.stage === "hermes_otp" || pending?.stage === "hermes_schedule_otp") {
    await cancelHermesOtpSession();
  }
  pendingActions.delete(ctx.chat.id);
  await ctx.reply("Đã huỷ thao tác đang đợi.", Markup.removeKeyboard());
});

bot.command("deletehermes", async (ctx) => {
  const removed = await deleteHermesAccount(ctx.chat.id);
  pendingActions.delete(ctx.chat.id);
  await ctx.reply(removed ? "Đã xoá tài khoản Hermes đã lưu." : "Không tìm thấy tài khoản Hermes để xoá.");
});

bot.command("sethermes", async (ctx) => {
  const message = ctx.message.text.trim();
  const parts = message.split(/\s+/);
  if (parts.length < 3) {
    pendingActions.set(ctx.chat.id, { stage: "hermes_credentials" });
    await ctx.reply([
      "Nhập user và password Hermes trong tin nhắn tiếp theo.",
      "Mẫu:",
      "username Abc123@"
    ].join("\n"));
    return;
  }
  const hermesUsername = parts[1];
  const hermesPassword = parts.slice(2).join(" ");
  await saveHermesAccount({ secret: config.botSecretKey, chatId: ctx.chat.id, telegramUser: ctx.from, hermesUsername, hermesPassword });
  await ctx.reply(`Đã lưu tài khoản Hermes cho ${hermesUsername}. Đang test đăng nhập...`);
  const result = await enqueue(() => validateHermesLogin({ username: hermesUsername, password: hermesPassword, keepOtpSession: true }));
  if (result.otpRequired) {
    pendingActions.set(ctx.chat.id, { stage: "hermes_otp" });
    await ctx.reply("Hermes đang yêu cầu OTP. Sếp gửi mã OTP vào tin nhắn tiếp theo nhé. /cancel để huỷ.");
    return;
  }
  await ctx.reply(result.ok ? result.message : `Lưu rồi nhưng test Hermes lỗi: ${result.message}`, keyboard());
});

bot.command("kpi", async (ctx) => {
  await showKpiSummary(ctx);
});

bot.command(["lich", "schedule", "workschedule"], async (ctx) => {
  const date = parseScheduleCommandDate(ctx.message.text);
  if (!date) {
    await ctx.reply([
      "Ngày không hợp lệ Sếp.",
      "Mẫu dùng:",
      "/lich",
      "/lich hôm nay",
      "/lich mai",
      "/lich 28/04",
      "/lich 28/04/2026"
    ].join("\n"));
    return;
  }
  await showWorkSchedule(ctx, date);
});

bot.action("action:menu", async (ctx) => {
  await ctx.answerCbQuery();
  await ctx.reply("<b>Menu Hermes</b>", {
    parse_mode: "HTML",
    disable_web_page_preview: true,
    ...keyboard()
  });
});

bot.action("action:hermes_work", async (ctx) => {
  await ctx.answerCbQuery("Đang lấy lịch hôm nay...");
  await showWorkSchedule(ctx, new Date());
});

bot.action(/^action:hermes_work_offset:(-?\d+)$/, async (ctx) => {
  const offset = Number(ctx.match?.[1] || 0);
  await ctx.answerCbQuery("Đang lấy lịch...");
  await showWorkSchedule(ctx, getRelativeWorkScheduleDate(offset));
});

bot.action(/^action:hermes_work_date:(\d{4}-\d{2}-\d{2}):(-?\d+)$/, async (ctx) => {
  const baseDate = parseWorkScheduleDateInput(ctx.match?.[1]);
  const offset = Number(ctx.match?.[2] || 0);
  await ctx.answerCbQuery("Đang lấy lịch...");
  await showWorkSchedule(ctx, getRelativeWorkScheduleDate(offset, baseDate || new Date()));
});

bot.action("action:hermes_work_week", async (ctx) => {
  await ctx.answerCbQuery("Đang lấy lịch cả tuần...");
  await showWorkScheduleWeek(ctx, new Date());
});

bot.action("action:hermes_kpi", async (ctx) => {
  await ctx.answerCbQuery("Đang tải KPI...");
  await showKpiSummary(ctx);
});

bot.action(/^action:hermes_kpi_month:(\d{4}_\d{2})$/, async (ctx) => {
  const month = ctx.match?.[1];
  await ctx.answerCbQuery(`Đang tải KPI ${month}...`);
  await showKpiMonth(ctx, month);
});

bot.action("action:hermes_work_other", async (ctx) => {
  await ctx.answerCbQuery();
  await askWorkScheduleOtherDate(ctx);
});

bot.action("action:hermes_account", async (ctx) => {
  await ctx.answerCbQuery();
  const account = await getHermesAccount({ secret: config.botSecretKey, chatId: ctx.chat.id });
  if (account?.hermesUsername) {
    await ctx.reply(`Đang lưu tài khoản Hermes: ${account.hermesUsername}\nMuốn đổi thì gửi /sethermes.`);
    return;
  }
  pendingActions.set(ctx.chat.id, { stage: "hermes_credentials" });
  await ctx.reply([
    "Chưa lưu tài khoản Hermes.",
    "Gửi user và password Hermes trong tin nhắn tiếp theo.",
    "Mẫu:",
    "username Abc123@"
  ].join("\n"));
});

bot.action("action:hermes_current_user", async (ctx) => {
  await ctx.answerCbQuery();
  const account = await getHermesAccount({ secret: config.botSecretKey, chatId: ctx.chat.id });
  await ctx.reply(formatHermesAccountStatus(account), keyboard());
});

bot.action("action:delete_hermes", async (ctx) => {
  await ctx.answerCbQuery();
  const removed = await deleteHermesAccount(ctx.chat.id);
  pendingActions.delete(ctx.chat.id);
  await ctx.reply(removed ? "Đã xoá tài khoản Hermes đã lưu." : "Không tìm thấy tài khoản Hermes để xoá.", keyboard());
});

bot.action(/^action:hermes_work_detail:(.+):(\d+)$/, async (ctx) => {
  const cacheKey = ctx.match?.[1];
  const index = Number(ctx.match?.[2] || 0);
  const cached = workScheduleCache.get(cacheKey);
  await ctx.answerCbQuery();
  if (!cached) {
    await ctx.reply("Dữ liệu lịch đã hết hạn. Sếp bấm lấy lịch lại nhé.", keyboard());
    return;
  }
  const entry = cached.result.entries?.[index];
  if (!entry) {
    await ctx.reply("Không tìm thấy mục lịch này. Sếp bấm lấy lịch lại nhé.", workScheduleKeyboard(cached.result, cacheKey));
    return;
  }
  const requestOrderId = getRequestOrderIdFromScheduleEntry(entry);
  if (!requestOrderId) {
    await ctx.reply(formatWorkScheduleNoteOnlyDetail(entry, cached.result), {
      parse_mode: "HTML",
      ...workScheduleDetailKeyboard(cached.result, cacheKey, entry)
    });
    return;
  }

  const account = await getHermesAccountOrReply(ctx);
  if (!account) return;
  await ctx.reply("Đang lấy chi tiết PYC thật từ Hermes...");
  const detail = await enqueue(() => getRequestOrderDetailById({
    username: account.hermesUsername,
    password: account.hermesPassword,
    requestOrderId,
    storageState: account.hermesSession || null
  }));

  if (detail.sessionExpired) await clearHermesSession(ctx.chat.id);
  if (detail.otpRequired) {
    pendingActions.set(ctx.chat.id, { stage: "hermes_schedule_otp", date: cached.result.targetDate });
    await ctx.reply("Phiên Hermes đã hết hạn nên Hermes yêu cầu OTP lại. Sếp gửi mã OTP mới nhất rồi bấm lịch lại nhé. /cancel để huỷ.");
    return;
  }
  if (!detail.ok) {
    console.error("[hermes_work_detail] failed to fetch request order detail", {
      chatId: ctx.chat?.id,
      cacheKey,
      index,
      requestOrderId,
      ticket: entry?.ticket || "",
      message: detail.message || "Unknown error",
      sessionExpired: Boolean(detail.sessionExpired),
      otpRequired: Boolean(detail.otpRequired)
    });
    await ctx.reply([
      "Không lấy được chi tiết PYC thật từ Hermes.",
      String(detail.message || "Lỗi không xác định").slice(0, 700),
      "",
      "Em hiển thị chi tiết lịch đang có trước để Sếp không bị đứng flow."
    ].join("\n"), workScheduleDetailKeyboard(cached.result, cacheKey, entry));
    await ctx.reply(formatWorkScheduleNoteOnlyDetail(entry, cached.result), {
      parse_mode: "HTML",
      ...workScheduleDetailKeyboard(cached.result, cacheKey, entry)
    });
    return;
  }
  if (detail.storageState) {
    await saveHermesSession({ secret: config.botSecretKey, chatId: ctx.chat.id, storageState: detail.storageState });
  }
  await ctx.reply(formatRequestOrderDetailHtml(detail.order, { checkedAt: detail.checkedAt }), {
    parse_mode: "HTML",
    disable_web_page_preview: true,
    ...workScheduleDetailKeyboard(cached.result, cacheKey, entry, detail.order)
  });
});

bot.action(/^action:hermes_work_list:(.+)$/, async (ctx) => {
  const cacheKey = ctx.match?.[1];
  const cached = workScheduleCache.get(cacheKey);
  await ctx.answerCbQuery();
  if (!cached) {
    await ctx.reply("Dữ liệu lịch đã hết hạn. Sếp bấm lấy lịch lại nhé.", keyboard());
    return;
  }
  await ctx.reply(formatWorkScheduleResult(cached.result), {
    parse_mode: "HTML",
    ...workScheduleKeyboard(cached.result, cacheKey)
  });
});

bot.on("text", async (ctx) => {
  const pending = pendingActions.get(ctx.chat.id);
  if (!pending) {
    await ctx.reply("Em chưa hiểu lệnh này. Gửi /lich hoặc /menu nhé Sếp.", keyboard());
    return;
  }

  if (pending.stage === "hermes_otp") {
    const otp = ctx.message.text.trim();
    await ctx.reply("Đang xác nhận OTP Hermes...");
    const result = await enqueue(() => submitHermesOtp(otp));
    if (result.otpRequired) {
      await ctx.reply(result.message);
      return;
    }
    pendingActions.delete(ctx.chat.id);
    if (!result.ok) {
      await ctx.reply(`Xác nhận OTP lỗi: ${result.message}`, keyboard());
      return;
    }
    if (result.storageState) await saveHermesSession({ secret: config.botSecretKey, chatId: ctx.chat.id, storageState: result.storageState });
    await ctx.reply(result.message, keyboard());
    return;
  }

  if (pending.stage === "hermes_schedule_otp") {
    const otp = ctx.message.text.trim();
    await ctx.reply("Đang xác nhận OTP Hermes và lấy lịch...");
    const result = await enqueue(() => submitHermesOtpAndGetWorkSchedule(otp, { date: pending.date }));
    if (result.otpRequired) {
      await ctx.reply(result.message);
      return;
    }
    pendingActions.delete(ctx.chat.id);
    if (!result.ok) {
      await ctx.reply(`Xác nhận OTP/lấy lịch lỗi: ${result.message}`, keyboard());
      return;
    }
    if (result.storageState) await saveHermesSession({ secret: config.botSecretKey, chatId: ctx.chat.id, storageState: result.storageState });
    const cacheKey = rememberWorkSchedule(ctx, result);
    await ctx.reply(formatWorkScheduleResult(result), {
      parse_mode: "HTML",
      ...workScheduleKeyboard(result, cacheKey)
    });
    return;
  }

  if (pending.stage === "hermes_schedule_date") {
    const date = parseWorkScheduleDateInput(ctx.message.text);
    if (!date) {
      await ctx.reply("Ngày không hợp lệ Sếp. Gửi theo mẫu 28/04 hoặc 28/04/2026, hoặc /cancel để huỷ.");
      return;
    }
    pendingActions.delete(ctx.chat.id);
    await showWorkSchedule(ctx, date);
    return;
  }

  if (pending.stage === "hermes_credentials") {
    const parts = ctx.message.text.trim().split(/\s+/);
    if (parts.length < 2) {
      await ctx.reply([
        "Chưa đúng mẫu nhập.",
        "Gửi lại user và password Hermes trên cùng 1 dòng.",
        "Ví dụ:",
        "username Abc123@"
      ].join("\n"));
      return;
    }
    const hermesUsername = parts[0];
    const hermesPassword = parts.slice(1).join(" ");
    await saveHermesAccount({ secret: config.botSecretKey, chatId: ctx.chat.id, telegramUser: ctx.from, hermesUsername, hermesPassword });
    pendingActions.delete(ctx.chat.id);
    await ctx.reply(`Đã lưu tài khoản Hermes cho ${hermesUsername}. Đang test đăng nhập...`);
    const result = await enqueue(() => validateHermesLogin({ username: hermesUsername, password: hermesPassword, keepOtpSession: true }));
    if (result.otpRequired) {
      pendingActions.set(ctx.chat.id, { stage: "hermes_otp" });
      await ctx.reply("Hermes đang yêu cầu OTP. Sếp gửi mã OTP vào tin nhắn tiếp theo nhé. /cancel để huỷ.");
      return;
    }
    await ctx.reply(result.ok ? result.message : `Lưu rồi nhưng test Hermes lỗi: ${result.message}`, keyboard());
  }
});

bot.catch((error, ctx) => {
  console.error("Hermes schedule bot error:", error);
  if (ctx?.reply) ctx.reply("Bot lịch Hermes gặp lỗi ngoài dự kiến. Xem log để biết chi tiết.").catch(() => {});
});

acquireInstanceLock()
  .then(() => bot.launch())
  .then(async () => {
    console.log("Hermes schedule Telegram bot is running.");
    await syncTelegramCommandMenu();
    if (config.startupNotify) {
      await notifyAllowedUsers("Bot lịch Hermes đã khởi động OK.");
    }
  })
  .catch(async (error) => {
    console.error("Cannot launch Hermes schedule bot:", error);
    await releaseInstanceLock();
    process.exit(1);
  });

process.once("SIGINT", async () => {
  bot.stop("SIGINT");
  await releaseInstanceLock();
});

process.once("SIGTERM", async () => {
  bot.stop("SIGTERM");
  await releaseInstanceLock();
});
