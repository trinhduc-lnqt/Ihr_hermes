import { Telegraf, Markup } from "telegraf";
import { config } from "../src/config.js";
import { getAllowedTelegramIds } from "../src/access.js";

const bot = new Telegraf(config.telegramToken);
const args = process.argv.slice(2);
const type = args[0] || "checkin"; // "checkin" hoặc "checkout"

async function sendReminders() {
  const ids = await getAllowedTelegramIds();
  const title = type === "checkin" ? "⏰ ĐẾN GIỜ CHECK IN" : "🏃‍♂️ ĐẾN GIỜ CHECK OUT";
  const desc = type === "checkin" ? "Sếp vào làm chưa? Bấm nút dưới để chấm công luôn nhé 💖" : "Xong việc chưa Sếp? Bấm nút dưới để chấm công ra nhé 💖";
  const actionOk = type === "checkin" ? "action:checkin" : "action:checkout";
  const actionLate = type === "checkin" ? "action:checkinmuon" : "action:checkoutsom";
  const btnOk = type === "checkin" ? "✅ Check In" : "🚪 Check Out";
  const btnLate = type === "checkin" ? "✍️ Check In (Lý do riêng)" : "🏃 Check Out (Lý do riêng)";

  for (const telegramId of ids) {
    try {
      await bot.telegram.sendMessage(telegramId, `*${title}*\n${desc}`, {
        parse_mode: "Markdown",
        reply_markup: Markup.inlineKeyboard([
          [Markup.button.callback(btnOk, actionOk)],
          [Markup.button.callback(btnLate, actionLate)]
        ]).reply_markup
      });
      console.log(`[OK] Đã gửi nhắc nhở ${type} tới ${telegramId}`);
    } catch (error) {
      console.error(`[LOI] Khong gui duoc cho ${telegramId}:`, error.message);
    }
  }
}

sendReminders().catch(console.error);
