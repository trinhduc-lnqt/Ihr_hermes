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
  getWorkScheduleByDay,
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
  { command: "start", description: "Mo menu lich Hermes" },
  { command: "lich", description: "Xem lich lam viec Hermes theo ngay" },
  { command: "sethermes", description: "Luu tai khoan Hermes" },
  { command: "deletehermes", description: "Xoa tai khoan Hermes" },
  { command: "id", description: "Xem Telegram ID" },
  { command: "cancel", description: "Huy thao tac dang doi" }
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
    [Markup.button.callback("🔐 Tài khoản Hermes", "action:hermes_account"), Markup.button.callback("🗑️ Xoá TK Hermes", "action:delete_hermes")],
    [Markup.button.callback("👤 Check user hiện tại", "action:hermes_current_user")]
  ]);
}

function compactButtonLabel(text, maxLength = 42) {
  const value = String(text || "").replace(/\s+/g, " ").trim();
  return value.length > maxLength ? `${value.slice(0, maxLength - 1)}…` : value;
}

function firstValidScheduleLink(entry) {
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
    const entry = entries[index];
    const label = compactButtonLabel(formatWorkScheduleSummaryLine(entry));
    rows.push([Markup.button.callback(`${index + 1}. ${label}`, `action:hermes_work_detail:${cacheKey}:${index}`)]);
  }
  rows.push([
    Markup.button.callback("◀️ Trước", `action:hermes_work_date:${result.targetDate}:-1`),
    Markup.button.callback("Sau ▶️", `action:hermes_work_date:${result.targetDate}:1`)
  ]);
  rows.push([
    Markup.button.callback("📆 Chọn ngày", "action:hermes_work_other"),
    Markup.button.callback("⬅️ Menu", "action:menu")
  ]);
  return Markup.inlineKeyboard(rows);
}

function workScheduleDetailKeyboard(result, cacheKey, entry = null) {
  const rows = [];
  const link = firstValidScheduleLink(entry);
  if (link) rows.push([Markup.button.url("🔗 Mở Hermes", link)]);
  rows.push([Markup.button.callback("⬅️ Về danh sách lịch", `action:hermes_work_list:${cacheKey}`)]);
  rows.push([
    Markup.button.callback("📆 Chọn ngày", "action:hermes_work_other"),
    Markup.button.callback("⬅️ Menu", "action:menu")
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

function formatWeekScheduleResult(results, checkedAt = new Date()) {
  const checkedLabel = new Intl.DateTimeFormat("vi-VN", {
    dateStyle: "short",
    timeStyle: "medium",
    timeZone: config.timezoneId
  }).format(checkedAt);
  const lines = [
    "🗓️ <b>Lịch cả tuần</b>",
    `⏱ <b>Kiểm tra lúc:</b> ${checkedLabel}`,
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
    lines.push(`📅 <b>${label}</b>`);
    if (!result.entries?.length) {
      lines.push("- Không có lịch");
      lines.push("");
      continue;
    }
    for (const [index, entry] of result.entries.slice(0, 10).entries()) {
      lines.push(`${index + 1}. ${formatWorkScheduleSummaryLine(entry)}`);
    }
    if (result.entries.length > 10) {
      lines.push(`... và ${result.entries.length - 10} lịch nữa`);
    }
    lines.push("");
  }

  return lines.join("\n");
}

function helpText(telegramId) {
  return [
    "Bot lịch làm việc Hermes đã sẵn sàng.",
    "",
    `Telegram ID của Sếp: ${telegramId}`,
    "",
    "Lệnh nhanh:",
    "/lich                 - xem lịch hôm nay",
    "/lich mai             - xem lịch ngày mai",
    "/lich 28/04           - xem lịch theo ngày",
    "/sethermes            - lưu tài khoản Hermes",
    "/deletehermes         - xoá tài khoản Hermes",
    "/cancel               - huỷ thao tác đang đợi"
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
    "Sếp gửi ngày muốn xem lịch Hermes nhé.",
    "Mẫu:",
    "28/04",
    "28/04/2026",
    "mai",
    "hôm nay",
    "",
    "/cancel để huỷ."
  ].join("\n"));
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
  await ctx.reply(helpText(ctx.from.id), keyboard());
});

bot.command("id", async (ctx) => {
  await ctx.reply(`Telegram ID của Sếp: ${getTelegramId(ctx)}`);
});

bot.command("menu", async (ctx) => {
  await ctx.reply("Menu lịch Hermes:", keyboard());
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
  await ctx.reply("Menu lịch Hermes:", keyboard());
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
    await ctx.reply(`Không lấy được chi tiết PYC thật từ Hermes.\n${String(detail.message || "Lỗi không xác định").slice(0, 700)}`, workScheduleDetailKeyboard(cached.result, cacheKey, entry));
    return;
  }
  if (detail.storageState) {
    await saveHermesSession({ secret: config.botSecretKey, chatId: ctx.chat.id, storageState: detail.storageState });
  }
  await ctx.reply(formatRequestOrderDetailHtml(detail.order, { checkedAt: detail.checkedAt }), {
    parse_mode: "HTML",
    disable_web_page_preview: true,
    ...workScheduleDetailKeyboard(cached.result, cacheKey, entry)
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
