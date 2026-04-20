import net from "node:net";

import { Markup, Telegraf } from "telegraf";

import { getAllowedTelegramIds, isAuthorizedTelegramId } from "./access.js";
import {
  buildAttendanceStateAfterMinute,
  buildAttendanceStateAfterReason,
  parseAdjMinuteInput
} from "./attendanceFlow.js";
import { assertBotConfig, config } from "./config.js";
import { probeIhrAvailability, submitAttendance } from "./ihrClient.js";
import { deleteUserAccount, getUserAccount, saveUserAccount } from "./store.js";
import { connectVpn, diagnoseConfPaths, disconnectVpn, findConfPath, getVpnStatus } from "./wireguard.js";

assertBotConfig();

const bot = new Telegraf(config.telegramToken);
const pendingActions = new Map();
const startedAt = new Date();
const UI = {
  checkIn: "\u2705 Check In",
  checkOut: "\u{1F6AA} Check Out",
  status: "\u{1F4CA} Trang thai",
  account: "\u{1F464} Thong tin tai khoan",
  deleteAccount: "\u{1F5D1}\uFE0F Xoa tai khoan",
  vpnOn: "\u{1F512} Bat VPN",
  vpnOff: "\u{1F513} Tat VPN",
  vpnStatus: "\u{1F4E1} TT VPN",
  vpnStateOn: "\u{1F512}",
  vpnStateOff: "\u{1F513}",
  vpnStateWarn: "\u26A0\uFE0F",
  ok: "\u2705",
  error: "\u274C",
  sendLocation: "\u{1F4CD} Gui vi tri",
  openMaps: "\u{1F5FA}\uFE0F Mo Google Maps"
};
const telegramCommands = [
  { command: "start", description: "Mo menu bot" },
  { command: "menu", description: "Hien menu thao tac" },
  { command: "checkin", description: "Bat dau check in" },
  { command: "checkout", description: "Bat dau check out" },
  { command: "status", description: "Kiem tra bot va IHR/VPN" },
  { command: "vpn", description: "Quan ly WireGuard VPN" },
  { command: "vpnon", description: "Bat WireGuard VPN" },
  { command: "vpnoff", description: "Tat WireGuard VPN" },
  { command: "vpndiag", description: "Chan doan path config WireGuard" },
  { command: "setaccount", description: "Luu tai khoan IHR" },
  { command: "account", description: "Xem tai khoan dang luu" },
  { command: "deleteaccount", description: "Xoa tai khoan dang luu" },
  { command: "cancel", description: "Huy thao tac dang doi" },
  { command: "skiplocation", description: "Dung toa do mac dinh" },
  { command: "id", description: "Xem Telegram ID cua ban" }
];

let instanceLockServer = null;
let ihrStatusTimer = null;
let heartbeatTimer = null;
let lastIhrReachable = null;
let lastIhrProbe = null;
let isIhrProbeRunning = false;
let isHeartbeatRunning = false;

let queue = Promise.resolve();
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
    "Telegram ID cua ban:",
    telegramId || "(khong xac dinh)",
    "",
    "Bot hien dang khoa.",
    "Hay gui ID nay cho admin de duoc them vao danh sach cho phep."
  ].join("\n");
}

function pickVpnStateIcon({ ok, running }) {
  if (!ok) {
    return UI.vpnStateWarn;
  }
  return running ? UI.vpnStateOn : UI.vpnStateOff;
}

function formatVpnStatusReply(status) {
  return `${pickVpnStateIcon(status)} ${status.message}`;
}

function formatVpnActionReply(result) {
  const lines = String(result.message || "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  if (lines.length === 0) {
    return `${result.ok ? UI.ok : UI.error} ${result.ok ? "[OK]" : "[LOI]"}`;
  }

  return lines
    .map((line, index) => {
      if (index === 0) {
        return `${result.ok ? UI.ok : UI.error} ${result.ok ? "[OK]" : "[LOI]"} ${line}`;
      }

      const hasOn = line.includes("(ON)");
      const hasOff = line.includes("(OFF)");
      if (!hasOn && !hasOff) {
        return `${UI.vpnStateWarn} ${line}`;
      }
      return `${pickVpnStateIcon({ ok: true, running: hasOn && !hasOff })} ${line}`;
    })
    .join("\n");
}

async function isAllowedUser(ctx) {
  if (!isPrivateChat(ctx)) {
    return false;
  }
  return isAuthorizedTelegramId(getTelegramId(ctx));
}

function keyboard() {
  const rows = [
    [Markup.button.callback(UI.checkIn, "action:checkin"), Markup.button.callback(UI.checkOut, "action:checkout")],
    [Markup.button.callback(UI.status, "action:status"), Markup.button.callback(UI.account, "action:account")],
    [Markup.button.callback(UI.deleteAccount, "action:delete")]
  ];

  if (config.wgTunnelName) {
    rows.push([
      Markup.button.callback(UI.vpnOn, "action:vpnon"),
      Markup.button.callback(UI.vpnOff, "action:vpnoff"),
      Markup.button.callback(UI.vpnStatus, "action:vpnstatus")
    ]);
  }

  return Markup.inlineKeyboard(rows);
}

function locationKeyboard() {
  return Markup.keyboard([[Markup.button.locationRequest(UI.sendLocation)]])
    .resize()
    .oneTime();
}

function mapsInlineKeyboard() {
  return Markup.inlineKeyboard([
    [Markup.button.url(UI.openMaps, "https://maps.google.com")]
  ]);
}

/**
 * Gui prompt yeu cau vi tri:
 * - Tin nhan 1: inline keyboard mo Google Maps
 * - Tin nhan 2: reply keyboard "Gui vi tri" de chia se qua Telegram
 */
async function sendLocationPrompt(ctx, prefixLines = []) {
  const lines = [
    ...prefixLines,
    "",
    "Chon 1 trong 3 cach lay vi tri:",
    `1. Bam nut [${UI.sendLocation}] phia duoi de chia se vi tri Telegram.`,
    `2. Bam [${UI.openMaps}] -> chon vi tri -> sao chep toa do -> gui vao day.`,
    "      Vi du: 21.0381, 105.8147",
    "3. Gui /skiplocation de dung toa do mac dinh trong .env."
  ];

  await ctx.reply(lines.join("\n"), mapsInlineKeyboard());
  await ctx.reply("Hoac bam nut de gui vi tri truc tiep:", locationKeyboard());
}

function helpText(telegramId) {
  const lines = [
    "Bot IHR da san sang.",
    "",
    `Telegram ID cua may: ${telegramId}`,
    "",
    "Lenh nhanh:",
    "/setaccount                        - bat dau nhap tai khoan IHR",
    "  Vi du: username Abc123@",
    "/checkin                           - bat dau check in",
    "  Vi du ly do: Lam viec tai nha",
    "/checkout                          - bat dau check out",
    "  Vi du ly do: Onsite PYC123456",
    "/status                            - kiem tra bot va ket noi IHR/VPN",
    "/account                           - xem account dang luu",
    "/deleteaccount                     - xoa account da luu",
    "/cancel                            - huy thao tac dang doi",
    "/skiplocation                      - dung toa do mac dinh trong .env"
  ];

  if (config.wgTunnelName) {
    lines.push("");
    lines.push("Quan ly WireGuard VPN:");
    lines.push(`/vpn                               - xem trang thai VPN (${config.wgTunnelName})`);
    lines.push("/vpnon                             - bat VPN");
    lines.push("/vpnoff                            - tat VPN");
  }

  return lines.join("\n");
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

  const parts = [];
  if (hours > 0) {
    parts.push(`${hours}h`);
  }
  if (minutes > 0 || hours > 0) {
    parts.push(`${minutes}m`);
  }
  parts.push(`${seconds}s`);
  return parts.join(" ");
}

function summarizeProbeMessage(message) {
  const text = String(message || "")
    .replace(/\r/g, "")
    .split("Call log:")[0]
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .join(" ");

  return text || "Chua co du lieu kiem tra IHR.";
}

function buildStatusText() {
  const lines = [
    `May: ${config.machineName}`,
    "Bot: online",
    `Bat dau: ${formatDateTime(startedAt)}`,
    `Uptime: ${formatDuration(Date.now() - startedAt.getTime())}`,
    `Che do gui lenh: ${config.transport}`
  ];

  if (config.wgTunnelName) {
    lines.push("VPN: dung /vpn hoac nut TT VPN de kiem tra nhanh");
  }

  if (lastIhrProbe) {
    lines.push(`IHR gan nhat: ${lastIhrProbe.ok ? "OK" : "LOI"}`);
    lines.push(`Luc kiem tra: ${formatDateTime(lastIhrProbe.checkedAt)}`);
    lines.push(lastIhrProbe.message);
  } else {
    lines.push("IHR gan nhat: chua co du lieu");
  }

  return lines.join("\n");
}

function buildIhrAlertText(probeResult, label) {
  return [
    `${label}: ${config.machineName}`,
    `Luc: ${formatDateTime(new Date())}`,
    `IHR/VPN: ${probeResult.ok ? "OK" : "LOI"}`,
    probeResult.message
  ].join("\n");
}

async function notifyAllowedUsers(message) {
  const ids = await getAllowedTelegramIds();
  if (!ids.size) {
    return;
  }

  for (const telegramId of ids) {
    try {
      await bot.telegram.sendMessage(telegramId, message);
    } catch (error) {
      console.warn(`Cannot send Telegram notification to ${telegramId}:`, error.message);
    }
  }
}

async function runIhrProbe() {
  const probeResult = await probeIhrAvailability();
  const normalized = {
    ...probeResult,
    message: summarizeProbeMessage(probeResult.message),
    checkedAt: new Date()
  };
  lastIhrReachable = normalized.ok;
  lastIhrProbe = normalized;
  return normalized;
}

async function checkIhrStatusChange() {
  if (isIhrProbeRunning) {
    return;
  }

  isIhrProbeRunning = true;
  try {
    const previousStatus = lastIhrReachable;
    const probeResult = await runIhrProbe();

    if (previousStatus === null || previousStatus === probeResult.ok) {
      return;
    }

    await notifyAllowedUsers(
      buildIhrAlertText(probeResult, probeResult.ok ? "Ket noi IHR da phuc hoi" : "Canh bao IHR/VPN")
    );
  } catch (error) {
    console.error("IHR status monitor error:", error);
  } finally {
    isIhrProbeRunning = false;
  }
}

async function sendHeartbeat() {
  if (!config.heartbeatUrl || isHeartbeatRunning) {
    return;
  }

  isHeartbeatRunning = true;
  try {
    const response = await fetch(config.heartbeatUrl, {
      method: "GET",
      signal: AbortSignal.timeout(config.timeoutMs)
    });
    if (!response.ok) {
      console.error(`Heartbeat failed with HTTP ${response.status}`);
    }
  } catch (error) {
    console.error("Heartbeat failed:", error.message);
  } finally {
    isHeartbeatRunning = false;
  }
}

function startRuntimeMonitors() {
  if (config.ihrStatusCheckIntervalMinutes > 0) {
    ihrStatusTimer = setInterval(() => {
      checkIhrStatusChange().catch((error) => {
        console.error("IHR status interval error:", error);
      });
    }, config.ihrStatusCheckIntervalMinutes * 60 * 1000);
    ihrStatusTimer.unref?.();
  }

  if (config.heartbeatUrl && config.heartbeatIntervalMinutes > 0) {
    heartbeatTimer = setInterval(() => {
      sendHeartbeat().catch((error) => {
        console.error("Heartbeat interval error:", error);
      });
    }, config.heartbeatIntervalMinutes * 60 * 1000);
    heartbeatTimer.unref?.();
  }
}

async function initializeRuntimeState() {
  await syncTelegramCommandMenu();
  const probeResult = await runIhrProbe();

  if (config.startupNotify) {
    await notifyAllowedUsers(buildIhrAlertText(probeResult, "Bot da khoi dong OK"));
  }

  await sendHeartbeat();
  startRuntimeMonitors();
}

async function syncTelegramCommandMenu() {
  try {
    await bot.telegram.setMyCommands(telegramCommands);
    await bot.telegram.setMyCommands(telegramCommands, {
      scope: { type: "all_private_chats" }
    });
    await bot.telegram.setChatMenuButton({
      menuButton: { type: "commands" }
    });
  } catch (error) {
    console.error("Cannot sync Telegram command menu:", error);
  }
}

function stopRuntimeMonitors() {
  if (ihrStatusTimer) {
    clearInterval(ihrStatusTimer);
    ihrStatusTimer = null;
  }
  if (heartbeatTimer) {
    clearInterval(heartbeatTimer);
    heartbeatTimer = null;
  }
}

async function acquireInstanceLock() {
  await new Promise((resolve, reject) => {
    const server = net.createServer();
    server.on("error", (error) => {
      if (error.code === "EADDRINUSE") {
        reject(new Error(`Another IHR Telegram bot instance is already running on port ${config.lockPort}.`));
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
  if (!instanceLockServer) {
    return;
  }

  await new Promise((resolve) => {
    instanceLockServer.close(() => resolve());
  });
  instanceLockServer = null;
}

async function guard(ctx, next) {
  if (!isPrivateChat(ctx)) {
    if (ctx.callbackQuery) {
      await ctx.answerCbQuery("Bot chi hoat dong trong chat private.");
    }
    if (ctx.reply) {
      await ctx.reply("Bot chi hoat dong trong chat private. Hay mo chat rieng voi bot.");
    }
    return;
  }

  if (isStartLikeUpdate(ctx)) {
    return next();
  }

  if (!(await isAllowedUser(ctx))) {
    if (ctx.callbackQuery) {
      await ctx.answerCbQuery("Telegram ID cua ban chua duoc cap quyen.");
    }
    if (ctx.reply) {
      await ctx.reply(buildUnauthorizedText(ctx), Markup.removeKeyboard());
    }
    return;
  }
  return next();
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
  const allowed = await isAllowedUser(ctx);
  if (!allowed) {
    await ctx.reply(buildUnauthorizedText(ctx), Markup.removeKeyboard());
    return;
  }
  await ctx.reply(`Telegram ID cua ban: ${getTelegramId(ctx)}`);
});

bot.command("menu", async (ctx) => {
  await ctx.reply("Chon thao tac:", keyboard());
});

bot.command("status", async (ctx) => {
  await ctx.reply(buildStatusText(), keyboard());
});

// --- VPN COMMANDS ---

bot.command("vpn", async (ctx) => {
  if (!config.wgTunnelName) {
    await ctx.reply("Chua cau hinh WireGuard. Them WG_TUNNEL_NAME vao file .env.", keyboard());
    return;
  }
  await ctx.reply("Dang kiem tra trang thai VPN...");
  const status = await getVpnStatus(config.wgTunnelName);
  await ctx.reply(formatVpnStatusReply(status), keyboard());
});

bot.command("vpnon", async (ctx) => {
  if (!config.wgTunnelName) {
    await ctx.reply("Chua cau hinh WireGuard. Them WG_TUNNEL_NAME vao file .env.", keyboard());
    return;
  }
  await ctx.reply("Dang bat VPN. Ket noi mang the bi gian doan giay lat...");
  const result = await connectVpn(config.wgTunnelName, config.wgConfPath);
  try {
    await ctx.reply(formatVpnActionReply(result), keyboard());
  } catch (error) {
    console.log("Bo qua loi Telegram gui tin do mang reset khi bat VPN:", error.message);
  }
});

bot.command("vpnoff", async (ctx) => {
  if (!config.wgTunnelName) {
    await ctx.reply("Chua cau hinh WireGuard. Them WG_TUNNEL_NAME vao file .env.", keyboard());
    return;
  }
  await ctx.reply("Dang tat VPN...");
  const result = await disconnectVpn(config.wgTunnelName);
  await ctx.reply(formatVpnActionReply(result), keyboard());
});

bot.command("vpndiag", async (ctx) => {
  if (!config.wgTunnelName) {
    await ctx.reply("Chua cau hinh WireGuard. Them WG_TUNNEL_NAME vao file .env.");
    return;
  }
  const lines = [
    `Chan doan WireGuard - tunnel: ${config.wgTunnelName}`,
    "",
    "Tim kiem file .conf:"
  ];
  const diagResults = diagnoseConfPaths(config.wgTunnelName, config.wgConfPath);
  lines.push(...diagResults);

  const foundPath = findConfPath(config.wgTunnelName, config.wgConfPath);
  lines.push("");
  if (foundPath) {
    lines.push(`=> Dung file: ${foundPath}`);
  } else {
    lines.push("=> Khong tim thay file .conf!");
    lines.push("");
    lines.push("Giai phap: Them vao .env:");
    lines.push(`WG_CONF_PATH=C:\\duong\\dan\\den\\${config.wgTunnelName}.conf`);
    lines.push("");
    lines.push("Huong dan tim file:");
    lines.push("WireGuard App -> Chon tunnel -> Edit -> luu noi dung vao 1 file .conf");
  }

  await ctx.reply(lines.join("\n"), keyboard());
});

bot.command("account", async (ctx) => {
  const account = await getUserAccount({ secret: config.botSecretKey, chatId: ctx.chat.id });
  if (!account) {
    await ctx.reply("Chua co tai khoan IHR. Gui /setaccount roi nhap theo mau: username Abc123@");
    return;
  }
  await ctx.reply(`Dang luu tai khoan IHR: ${account.ihrUsername}`);
});

bot.command("deleteaccount", async (ctx) => {
  const removed = await deleteUserAccount(ctx.chat.id);
  pendingActions.delete(ctx.chat.id);
  await ctx.reply(removed ? "Da xoa tai khoan IHR da luu." : "Khong tim thay tai khoan de xoa.");
});

bot.command("cancel", async (ctx) => {
  pendingActions.delete(ctx.chat.id);
  await ctx.reply("Da huy thao tac dang doi.", Markup.removeKeyboard());
});

bot.command("skiplocation", async (ctx) => {
  const pending = pendingActions.get(ctx.chat.id);
  if (!pending || pending.stage !== "location" || !pending.reason) {
    await ctx.reply("Hien khong co thao tac nao dang cho vi tri.");
    return;
  }

  pendingActions.delete(ctx.chat.id);
  await ctx.reply("Da bo qua vi tri Telegram. Bot se dung toa do mac dinh trong .env.", Markup.removeKeyboard());
  await queueAttendance(ctx, pending.action, pending.reason, null, pending.adjMinute);
});

bot.command("setaccount", async (ctx) => {
  const message = ctx.message.text.trim();
  const parts = message.split(/\s+/);
  if (parts.length < 3) {
    pendingActions.set(ctx.chat.id, { stage: "account_credentials" });
    await ctx.reply(
      [
        "Nhap user va password IHR trong tin nhan tiep theo.",
        "Mau nhap:",
        "username Abc123@"
      ].join("\n")
    );
    return;
  }

  const ihrUsername = parts[1];
  const ihrPassword = parts.slice(2).join(" ");

  await saveUserAccount({
    secret: config.botSecretKey,
    chatId: ctx.chat.id,
    telegramUser: ctx.from,
    ihrUsername,
    ihrPassword
  });

  await ctx.reply(`Da luu tai khoan IHR cho ${ihrUsername}.`, keyboard());
});

async function queueAttendance(ctx, action, reason, geo = null, adjMinute = undefined) {
  const account = await getUserAccount({ secret: config.botSecretKey, chatId: ctx.chat.id });
  if (!account) {
    await ctx.reply("Chua co tai khoan IHR. Gui /setaccount roi nhap theo mau: username Abc123@");
    return;
  }

  const actionText = action === "checkout" ? "Check Out" : "Check In";
  await ctx.reply(`Dang xu ly ${actionText} cho ${account.ihrUsername}...`);

  const result = await enqueue(() =>
    submitAttendance({
      username: account.ihrUsername,
      password: account.ihrPassword,
      reason,
      action,
      geo,
      adjMinute
    })
  );

  if (result.ok) {
    await ctx.reply(`${actionText} xong.\n${result.message}`, keyboard());
    return;
  }

  const lines = [`${actionText} that bai.`, result.message];
  if (result.screenshotPath) {
    lines.push(`Screenshot loi: ${result.screenshotPath}`);
  }
  await ctx.reply(lines.join("\n"), keyboard());
}

async function handleDirectCommand(ctx, action) {
  const command = action === "checkout" ? "/checkout" : "/checkin";
  const reason = ctx.message.text.slice(command.length).trim();
  if (!reason) {
    pendingActions.set(ctx.chat.id, { action, stage: "reason" });
    await ctx.reply(
      [
        action === "checkout"
          ? "Nhap ly do check out trong tin nhan tiep theo."
          : "Nhap ly do check in trong tin nhan tiep theo.",
        "Mau nhap:",
        action === "checkout" ? "Da roi khoi diem khach hang" : "Lam viec tai nha",
        "",
        "Co the /cancel neu muon huy."
      ].join("\n")
    );
    return;
  }
  pendingActions.set(ctx.chat.id, buildAttendanceStateAfterReason(action, reason));
  await ctx.reply(
    [
      action === "checkout" ? "Da nhan ly do check out." : "Da nhan ly do check in.",
      "Nhap so phut bu gio (so nguyen >= 0).",
      "Vi du: 0, 15, 30"
    ].join("\n")
  );
}

bot.command("checkin", async (ctx) => {
  await handleDirectCommand(ctx, "checkin");
});

bot.command("checkout", async (ctx) => {
  await handleDirectCommand(ctx, "checkout");
});

bot.action("action:checkin", async (ctx) => {
  pendingActions.set(ctx.chat.id, { action: "checkin", stage: "reason" });
  await ctx.answerCbQuery();
  await ctx.reply(
    [
      "Nhap ly do check in vao tin nhan tiep theo.",
      "Mau nhap:",
      "Lam viec tai nha"
    ].join("\n")
  );
});

bot.action("action:checkout", async (ctx) => {
  pendingActions.set(ctx.chat.id, { action: "checkout", stage: "reason" });
  await ctx.answerCbQuery();
  await ctx.reply(
    [
      "Nhap ly do check out vao tin nhan tiep theo.",
      "Mau nhap:",
      "Da roi khoi diem khach hang"
    ].join("\n")
  );
});

bot.action("action:account", async (ctx) => {
  await ctx.answerCbQuery();
  const account = await getUserAccount({ secret: config.botSecretKey, chatId: ctx.chat.id });
  await ctx.reply(account ? `Dang luu tai khoan: ${account.ihrUsername}` : "Chua luu tai khoan IHR.");
});

bot.action("action:status", async (ctx) => {
  await ctx.answerCbQuery();
  await ctx.reply(buildStatusText(), keyboard());
});

bot.action("action:vpnstatus", async (ctx) => {
  await ctx.answerCbQuery();
  if (!config.wgTunnelName) {
    await ctx.reply("Chua cau hinh WireGuard (WG_TUNNEL_NAME).");
    return;
  }
  const status = await getVpnStatus(config.wgTunnelName);
  await ctx.reply(formatVpnStatusReply(status), keyboard());
});

bot.action("action:vpnon", async (ctx) => {
  await ctx.answerCbQuery("Dang bat VPN...");
  if (!config.wgTunnelName) {
    await ctx.reply("Chua cau hinh WireGuard (WG_TUNNEL_NAME).");
    return;
  }
  await ctx.reply("Dang bat VPN. Ket noi mang the bi gian doan giay lat...");
  const result = await connectVpn(config.wgTunnelName, config.wgConfPath);
  try {
    await ctx.reply(formatVpnActionReply(result), keyboard());
  } catch (error) {
    console.log("Bo qua loi Telegram gui tin do mang reset khi bat VPN:", error.message);
  }
});

bot.action("action:vpnoff", async (ctx) => {
  await ctx.answerCbQuery("Dang tat VPN...");
  if (!config.wgTunnelName) {
    await ctx.reply("Chua cau hinh WireGuard (WG_TUNNEL_NAME).");
    return;
  }
  const result = await disconnectVpn(config.wgTunnelName);
  await ctx.reply(formatVpnActionReply(result), keyboard());
});

bot.action("action:delete", async (ctx) => {
  await ctx.answerCbQuery();
  const removed = await deleteUserAccount(ctx.chat.id);
  pendingActions.delete(ctx.chat.id);
  await ctx.reply(removed ? "Da xoa tai khoan IHR da luu." : "Khong co tai khoan nao de xoa.");
});

bot.on("text", async (ctx, next) => {
  if (ctx.message.text.startsWith("/")) {
    return next();
  }

  const pending = pendingActions.get(ctx.chat.id);
  if (!pending) {
    return next();
  }

  if (pending.stage === "account_credentials") {
    const parts = ctx.message.text.trim().split(/\s+/);
    if (parts.length < 2) {
      await ctx.reply(
        [
          "Chua dung mau nhap.",
          "Hay gui lai user va password tren cung 1 dong.",
          "Vi du:",
          "username Abc123@"
        ].join("\n")
      );
      return;
    }

    const ihrUsername = parts[0];
    const ihrPassword = parts.slice(1).join(" ");

    await saveUserAccount({
      secret: config.botSecretKey,
      chatId: ctx.chat.id,
      telegramUser: ctx.from,
      ihrUsername,
      ihrPassword
    });

    pendingActions.delete(ctx.chat.id);
    await ctx.reply(`Da luu tai khoan IHR cho ${ihrUsername}.`, keyboard());
    return;
  }

  if (pending.stage === "reason") {
    const reason = ctx.message.text.trim();
    if (!reason) {
      await ctx.reply("Ly do dang rong. Thu lai bang /checkin hoac /checkout.");
      return;
    }

    pendingActions.set(ctx.chat.id, buildAttendanceStateAfterReason(pending.action, reason));
    await ctx.reply(
      [
        "Da nhan ly do.",
        "Nhap so phut bu gio (so nguyen >= 0).",
        "Vi du: 0, 15, 30"
      ].join("\n")
    );
    return;
  }

  if (pending.stage === "adj_minute") {
    const adjMinute = parseAdjMinuteInput(ctx.message.text);
    if (adjMinute === null) {
      await ctx.reply("So phut bu gio khong hop le. Hay nhap so nguyen >= 0, vi du: 0, 15, 30.");
      return;
    }

    pendingActions.set(ctx.chat.id, buildAttendanceStateAfterMinute(pending, adjMinute));
    await sendLocationPrompt(ctx, [`Da nhan ${adjMinute} phut bu gio.`]);
    return;
  }

  if (pending.stage === "location") {
    const coordMatch = ctx.message.text.trim().match(
      /^(-?\d{1,3}(?:\.\d+)?)[,\s]+(-?\d{1,3}(?:\.\d+)?)$/
    );
    if (coordMatch) {
      const latitude = parseFloat(coordMatch[1]);
      const longitude = parseFloat(coordMatch[2]);
      if (
        latitude >= -90 && latitude <= 90 &&
        longitude >= -180 && longitude <= 180
      ) {
        pendingActions.delete(ctx.chat.id);
        await ctx.reply(
          `Da nhan toa do: ${latitude}, ${longitude}\nBat dau gui lenh...`,
          Markup.removeKeyboard()
        );
        await queueAttendance(ctx, pending.action, pending.reason, { latitude, longitude }, pending.adjMinute);
        return;
      }
    }
  await ctx.reply(
      [
        "Bot dang cho vi tri.",
        `Bam [${UI.sendLocation}], hoac nhap toa do (vi du: 21.0381, 105.8147), hoac /skiplocation.`
      ].join("\n")
    );
    return;
  }
});

bot.on("location", async (ctx) => {
  const pending = pendingActions.get(ctx.chat.id);
  if (!pending || pending.stage !== "location" || !pending.reason) {
    await ctx.reply("Khong co thao tac nao dang cho vi tri.");
    return;
  }

  pendingActions.delete(ctx.chat.id);
  await ctx.reply("Da nhan vi tri. Bat dau gui lenh...", Markup.removeKeyboard());
  await queueAttendance(ctx, pending.action, pending.reason, {
    latitude: ctx.message.location.latitude,
    longitude: ctx.message.location.longitude
  }, pending.adjMinute);
});

bot.catch((error, ctx) => {
  console.error("Telegram bot error:", error);
  if (ctx?.reply) {
    ctx.reply("Bot gap loi ngoai du kien. Xem terminal de biet them chi tiet.").catch(() => {});
  }
});

acquireInstanceLock()
  .then(() => bot.launch())
  .then(async () => {
    console.log("IHR Telegram bot is running.");
    await initializeRuntimeState();
  })
  .catch(async (error) => {
    console.error("Cannot launch Telegram bot:", error);
    await releaseInstanceLock();
    process.exit(1);
  });

process.once("SIGINT", async () => {
  stopRuntimeMonitors();
  bot.stop("SIGINT");
  await releaseInstanceLock();
});

process.once("SIGTERM", async () => {
  stopRuntimeMonitors();
  bot.stop("SIGTERM");
  await releaseInstanceLock();
});
