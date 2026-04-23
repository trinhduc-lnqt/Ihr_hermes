import { Telegraf, Markup } from "telegraf";
import { config } from "../src/config.js";
import { getAllowedTelegramIds } from "../src/access.js";

const bot = new Telegraf(config.telegramToken);
async function sendReminders() {
  const ids = await getAllowedTelegramIds();
  const title = "⏰ ĐẾN GIỜ CHECK IN";
  const desc = "Sếp vào làm chưa? Bấm nút dưới để nhập lý do check in nhé 💖";

  for (const telegramId of ids) {
    try {
      await bot.telegram.sendMessage(telegramId, `*${title}*\n${desc}`, {
        parse_mode: "Markdown",
        reply_markup: Markup.inlineKeyboard([
          [Markup.button.callback("✍️ Check In (Lý do riêng)", "action:checkin_reason")]
        ]).reply_markup
      });
      console.log(`[OK] Đã gửi nhắc nhở checkin tới ${telegramId}`);
    } catch (error) {
      console.error(`[LOI] Khong gui duoc cho ${telegramId}:`, error.message);
    }
  }
}

sendReminders().catch(console.error);
