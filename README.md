# IHR Telegram Bot (Linux VPS)

Bot Telegram chấm công IHR chạy trên VPS Linux, hỗ trợ Check-In, Check-Out, lưu tài khoản IHR theo từng Telegram user, và bật/tắt WireGuard khi cần.

## Cần có
- Ubuntu 22.04+ hoặc Debian tương đương
- Node.js 20+
- PM2
- wireguard-tools
- Telegram bot token từ BotFather
- WireGuard config dùng để vào mạng nội bộ IHR

## Cài nhanh
```bash
cd ihr-telegram-bot
npm install
cp .env.example .env
mkdir -p data vpn-configs
```

## Cấu hình .env
- `TELEGRAM_BOT_TOKEN`: token bot Telegram
- `BOT_SECRET_KEY`: chuỗi bí mật 32-64 ký tự
- `ALLOWED_TELEGRAM_IDS`: Telegram ID admin, ngăn cách dấu phẩy
- `IHR_GEO_LAT`, `IHR_GEO_LNG`: tọa độ mặc định
- `WG_TUNNEL_NAME`: tên tunnel, ví dụ `ihr-office`
- `WG_CONF_PATH`: đường dẫn file `.conf`, ví dụ `/home/ubuntu/ihr-telegram-bot/vpn-configs/ihr-office.conf`

## Chạy thử
```bash
npm run bot
```

## Chạy nền bằng PM2
```bash
pm2 start ecosystem.config.cjs
pm2 save
pm2 startup
```

## Lưu ý WireGuard trên Linux
Bot dùng `wg` và `wg-quick`. Nếu user chạy bot không có sudo không password cho `wg-quick`, lệnh bật/tắt VPN sẽ lỗi.

Ví dụ sudoers:
```bash
sudo visudo
```
Thêm:
```bash
youruser ALL=(ALL) NOPASSWD: /usr/bin/wg-quick, /usr/bin/wg
```

## Cách dùng
- `/start` mở menu
- `/setaccount` lưu tài khoản IHR
- `/checkin` check in
- `/checkout` check out
- `/vpn`, `/vpnon`, `/vpnoff` quản lý VPN
- `/status` xem trạng thái bot/IHR/VPN

## File cần Sếp đưa cho em để chạy thật
1. Telegram bot token
2. Telegram ID của Sếp
3. File WireGuard `.conf`
4. Tài khoản IHR để test
