# IHR Telegram Bot (VPS Edition)

Bot Telegram tự động hóa **Check-In / Check-Out** trên hệ thống IHR (`ihr.ipos.vn`) thông qua VPN WireGuard, chạy trên VPS Linux.

## Tính năng chính

- **Check-In / Check-Out từ xa** — Gửi lệnh qua Telegram, bot tự kết nối VPN và gọi API IHR
- **Quản lý VPN WireGuard** — Bật/tắt VPN riêng cho từng user, hiển thị tên IHR thay vì ID kỹ thuật
- **Nhập vị trí thông minh** — 5 cách: GPS Telegram, gõ tên địa điểm (geocoding tự động), tọa độ thủ công, địa điểm đã lưu, hoặc dùng mặc định
- **Quản lý user qua Telegram** — Admin thêm/xóa user, upload config WireGuard trực tiếp qua chat
- **An toàn** — Whitelist Telegram ID, mật khẩu IHR mã hóa AES-256, VPN chỉ route traffic IHR (không ảnh hưởng internet VPS)

---

## Yêu cầu

- **VPS Linux** (Ubuntu 22.04+ / ARM64 hoặc x86)
- **Node.js 20+**
- **PM2** (`npm install -g pm2`)
- **WireGuard Tools** (`sudo apt install wireguard-tools`)
- **Telegram Bot Token** (từ [@BotFather](https://t.me/BotFather))

---

## Cài đặt

### 1. Clone repo
```bash
git clone https://github.com/tam1012/IHRTELEGRAMBOTVPS.git
cd IHRTELEGRAMBOTVPS
npm install
```

### 2. Cấu hình
```bash
cp .env.example .env
nano .env
```

Sửa các giá trị trong `.env`:
| Biến | Mô tả |
|---|---|
| `TELEGRAM_BOT_TOKEN` | Token từ BotFather |
| `BOT_SECRET_KEY` | Chuỗi bí mật mã hóa (32-64 ký tự) |
| `ALLOWED_TELEGRAM_IDS` | Telegram ID admin (phân cách bằng dấu phẩy) |
| `IHR_GEO_LAT`, `IHR_GEO_LNG` | Tọa độ mặc định khi skip location |
| `BOT_MACHINE_NAME` | Tên hiển thị máy chủ |

### 3. Thêm user vào whitelist
```bash
echo "YOUR_TELEGRAM_ID" >> data/allowed-telegram-ids.txt
```

### 4. Tạo WireGuard config
Đặt file config tại thư mục cấu hình (đường dẫn trong `WG_CONF_PATH` hoặc mặc định cùng thư mục):
```bash
mkdir -p vpn-configs
# Đặt file wg-<TELEGRAM_ID>.conf vào đây
```

> **⚠️ Quan trọng:** Config WireGuard phải dùng `AllowedIPs = <IHR_SERVER_IP>/32` (KHÔNG dùng `0.0.0.0/0`) để tránh ảnh hưởng internet VPS.

### 5. Khởi chạy
```bash
pm2 start ecosystem.config.cjs
pm2 save
pm2 startup  # Tự khởi động khi VPS reboot
```

---

## Lệnh Bot — User

| Lệnh | Mô tả |
|---|---|
| `/start`, `/menu` | Mở menu bot |
| `/checkin` | Check in (hỗ trợ nhập vị trí thông minh) |
| `/checkout` | Check out |
| `/status` | Kiểm tra trạng thái bot + IHR + VPN |
| `/vpnon` / `/vpnoff` | Bật / tắt WireGuard VPN |
| `/vpn` | Xem trạng thái VPN |
| `/setaccount` | Lưu tài khoản IHR (`/setaccount user pass`) |
| `/account` | Xem tài khoản đang lưu |
| `/deleteaccount` | Xóa tài khoản |
| `/id` | Xem Telegram ID của mình |
| `/skiplocation` | Dùng tọa độ mặc định |

## Lệnh Bot — Admin Only

| Lệnh | Mô tả | Ví dụ |
|---|---|---|
| `/adduser <ID>` | Thêm user vào whitelist | `/adduser 1234567890` |
| `/removeuser <ID>` | Xóa user khỏi whitelist | `/removeuser 1234567890` |
| `/listusers` | Xem danh sách user (kèm IHR + WG status) | |
| `/setwg <ID>` | Upload file WireGuard config qua Telegram | `/setwg 1234567890` → gửi file |
| `/addlocation` | Lưu địa điểm hay dùng | `/addlocation Van phong | 21.03, 105.81` |
| `/removelocation` | Xóa địa điểm đã lưu | `/removelocation 1` |
| `/listlocations` | Xem danh sách địa điểm | |

> Admin ID được cấu hình trong `src/index.js` (biến `ADMIN_TELEGRAM_ID`).

---

## Cấu trúc thư mục

```
├── src/
│   ├── index.js           # Main bot logic + admin commands
│   ├── wireguard.js       # WireGuard VPN control
│   ├── ihrClient.js       # IHR API client
│   ├── access.js          # Whitelist access control
│   ├── store.js           # User data persistence
│   ├── config.js          # Environment config
│   ├── crypto.js          # AES-256 password encryption
│   └── attendanceFlow.js  # Check-in/out flow logic
├── data/
│   ├── users.json               # User accounts (auto-generated)
│   ├── allowed-telegram-ids.txt  # Whitelist
│   └── saved-locations.json      # Saved locations
├── .env.example
├── ecosystem.config.cjs          # PM2 config
└── package.json
```

---

## Bảo mật

- 🔒 Mật khẩu IHR được mã hóa **AES-256** bằng `BOT_SECRET_KEY`
- 🔒 Bot chỉ nhận message private (chặn group chat)
- 🔒 Whitelist Telegram ID — chỉ user được duyệt mới dùng được
- 🔒 Admin commands chỉ dành cho admin ID duy nhất
- 🔒 WireGuard config tự động sanitize (xóa DNS, fix AllowedIPs) khi upload qua `/setwg`

> **⚠️ KHÔNG push file `.env` lên GitHub.** File `.gitignore` đã tự động loại.

---

## Quản lý Bot

```bash
pm2 list                          # Xem trạng thái
pm2 logs ihr-telegram-bot         # Xem log realtime
pm2 restart ihr-telegram-bot      # Restart bot
pm2 stop ihr-telegram-bot         # Dừng bot
```

---

## License

Private use only.
