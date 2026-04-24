import { Telegraf, Markup } from "telegraf";
import { config } from "../src/config.js";
import { getAllowedTelegramIds } from "../src/access.js";

const bot = new Telegraf(config.telegramToken);
const args = process.argv.slice(2);
const type = args[0] || "checkin"; // "checkin" hoặc "checkout"

async function sendReminders() {
  const ids = await getAllowedTelegramIds();
  const title = type === "checkin" ? "⏰ ĐẾN GIỜ CHECK IN" : "🏃‍♂️ ĐẾN GIỜ CHECK OUT";
  const desc = type === "checkin" 
    ? "Sếp vào làm chưa? Bấm nút dưới để nhập lý do check in nhé 💖" 
    : "Xong việc chưa Sếp? Bấm nút dưới để nhập lý do check out nhé 💖";
  
  const btnLabel = type === "checkin" ? "✍️ Check In (Lý do riêng)" : "🏃 Check Out (Lý do riêng)";
  const btnAction = type === "checkin" ? "action:checkin_reason" : "action:checkout";

  for (const telegramId of ids) {
    try {
      await bot.telegram.sendMessage(telegramId, `*${title}*\n${desc}`, {
        parse_mode: "Markdown",
        reply_markup: Markup.inlineKeyboard([
          [Markup.button.callback(btnLabel, btnAction)]
        ]).reply_markup
      });
      console.log(`[OK] Đã gửi nhắc nhở ${type} tới ${telegramId}`);
    } catch (error) {
      console.error(`[LOI] Khong gui duoc cho ${telegramId}:`, error.message);
    }
  }
}

sendReminders().catch(console.error);
