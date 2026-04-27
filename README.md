# IHR Telegram Bot (Linux VPS)

Bot Telegram chấm công IHR chạy trên VPS Linux, hỗ trợ Check-In, Check-Out, thông báo lịch/bảng lương, lưu tài khoản IHR/Hermes theo từng Telegram user, và bật/tắt WireGuard khi cần.

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
- `IHR_STATUS_CHECK_INTERVAL_MINUTES`: chu kỳ kiểm tra và thông báo trạng thái IHR/VPN
- `SALARY_CHECK_INTERVAL_MINUTES`: chu kỳ kiểm tra thông báo bảng lương mới
- `HERMES_BASE_URL`: domain Hermes nếu muốn bot test đăng nhập Hermes sau khi lưu tài khoản
- `HERMES_LOGIN_PATH`: đường dẫn trang đăng nhập Hermes, mặc định `/System/Login`

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
- `/start` mở menu chính với 2 phần: `IHR - Chấm công` và `Hermes - Công việc`
- Trong `IHR - Chấm công`: check in/out, trạng thái, bảng lương, tài khoản IHR, VPN
- Trong `Hermes - Công việc`: tài khoản Hermes và các thao tác công việc Hermes
- `/setaccount` lưu tài khoản IHR
- `/sethermes` lưu tài khoản Hermes và test đăng nhập nếu đã cấu hình `HERMES_BASE_URL`
- `/checkin` check in
- `/checkout` check out
- `/vpn`, `/vpnon`, `/vpnoff` quản lý VPN
- `/status` xem trạng thái bot/IHR/VPN

## File cần Sếp đưa cho em để chạy thật
1. Telegram bot token
2. Telegram ID của Sếp
3. File WireGuard `.conf`
4. Tài khoản IHR để test
