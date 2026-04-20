# IHR Telegram Bot

Bot này được thiết kế để tự động hóa công việc **IHR Check-In/Check-Out qua Telegram:** Cho phép dùng laptop đang dùng VPN để thay mặt lên `ihr.ipos.vn` thực hiện thao tác check-in/out từ xa qua lệnh Telegram, không cần bật lại mạng công ty trên điện thoại.

---

## 1. Yêu cầu hệ thống

- Laptop Windows (hoặc Server) đang bật và truy cập được mạng nội bộ (`https://ihr.ipos.vn`).
- Đã cài **Node.js 20+**.
- Đổi cấu hình Windows sang trạng thái **không tự động sleep/ngủ đông**.
- Token của Telegram Bot, tài khoản Telegram chỉ định.

---

## 2. Cài đặt ban đầu

Mở PowerShell tại thư mục dự án:

```powershell
cd C:\Users\Ha Tam\Documents\Playground\projects\ihr-telegram-bot
npm install
npm run setup
npm run install:browsers
```

### Cách chia sẻ Bot (Dành cho người dùng cũ)
Nếu anh muốn xóa hết thông tin cá nhân của mình trước khi gửi file nén cho bạn bè, hãy chạy lệnh:
```powershell
npm run clean:private
```
Lệnh này sẽ xóa file `.env`, dữ liệu tài khoản trong `data/` và log cũ. Sau đó anh có thể yên tâm nén project và gửi đi. Người nhận chỉ cần giải nén và chạy `npm run setup`.

### Cấu hình file `.env`

Sửa file `.env` với các giá trị:

- `TELEGRAM_BOT_TOKEN`: token từ BotFather.
- `BOT_SECRET_KEY`: chuỗi bí mật mã hóa (ví dụ 32-64 ký tự).
- `ALLOWED_TELEGRAM_IDS`: IP/ID Telegram được quyền dùng bot.
- `HEADLESS=true`: chạy background, không hiện popup chrome.
- `IHR_TRANSPORT=http`: Gọi API thuần (nhanh & ổn định hơn browser automation).
- Tọa độ địa lý bắt buộc (nếu không dùng Telegram share location): `IHR_GEO_LAT` và `IHR_GEO_LNG`.

### Whitelist & An toàn của bot
- Mặc định sau khi tạo bot, người dùng muốn dùng phải `/start` để xem `Telegram ID`.
- Thêm ID đó vào file `data/allowed-telegram-ids.txt` (1 dòng 1 số).
- Bot chỉ đọc các ID từ file này (Real-time, đổi là nhận, không cần restart).

---

## 3. Khởi chạy Bot IHR Check-In

Hiện dự án hỗ trợ 3 cách để duy trì Bot chạy ngầm:

### Cách 1: Chạy như Windows Service ẩn ở mức hệ thống (KHUYÊN DÙNG TRÊN LAPTOP)
Các file `.bat` và `.ps1` đã được cung cấp để giả lập thành Scheduled Task chạy ẩn cấp quyền **SYSTEM**.

- Cài đặt vào startup `boot task`: Click đúp **`install_boot_task.bat`** (Chạy dưới quyền Administrator).
- Khởi động bot thủ công (khi đã cài): Click đúp **`start_boot_bot.bat`**.
- Xem trạng thái xem bot có chạy không: Click đúp **`status_boot_bot.bat`**.
- Khởi động lại khi lỗi: Click đúp **`restart_boot_bot.bat`**.
- Xóa hoàn toàn khởi động cùng hệ thống: Click đúp **`remove_boot_task.bat`**.

Bằng cách này, dù laptop vừa bật chưa nhập cả mật khẩu Windows, bot vẫn sẽ tự chạy nền cực kì bền bỉ.

### Cách 2: Chạy qua PM2 (Dành cho Server / VPS)
```powershell
npm install -g pm2
pm2 start ecosystem.config.cjs
pm2 save
pm2 logs ihr-telegram-bot
```

### Cách 3: Chạy chạy (Dành cho Test)
```powershell
npm run bot
```

---

## 4. Cách sử dụng Bot (Telegram Chat)

Bot hỗ trợ 2 kiểu nhập, gõ trên 1 dòng liên tục hoặc đi qua từng bước wizard.

- `/start`: Mở menu và xem Telegram ID của bạn.
- `/setaccount <user> <pass>`: Lưu tài khoản IHR một cách an toàn.
- `/account`: Xem thông tin account lưu trữ.
- `/checkin <ly do>`: Thực hiện Check-in.
- `/checkout <ly do>`: Thực hiện Check-out.
- `/deleteaccount`: Xóa tài khoản đã lưu.
- `/cancel`: Hủy flow đang mắc kẹt.
- `/skiplocation`: Dùng tọa độ cứng ở file `.env` nếu không muốn gửi vị trí live qua telegram.

*(Với tùy chọn `IHR_TRANSPORT=http`, bot sẽ tự phân tích vị trí tọa độ Telegram và tra cứu bản đồ Map bằng Geocoding tích hợp).*

---

## 5. Tính năng mở rộng: Bắt Request CheckIn Thực Tế

Khuyến nghị sử dụng cấu hình API thuần để đỡ lỗi Timeout của việc duyệt Chromium.

Tìm API Mới bằng Log Tracing:
```powershell
npm run capture:checkin
```
Scripts này sẽ bật trình duyệt. Anh dùng tay login, bấm Check In và "Save". Nó sẽ ngăn chặn tín hiệu lên server, móc API header đó ra log trong thư mục `artifacts/`. Lấy endpoint đó cho vào core của ứng dụng.

---

## 6. Lưu ý bảo mật

🚨 **Tất cả Token/Password không được lộ trong source code, hãy chỉ đặt trong file môi trường!**
1. **`.env`**: Chứa toàn bộ Telegram Bot Token và tham số hoạt động. KHÔNG PUSH file này lên github.
2. Bot giới hạn mức chặn chat nhóm (group), nó chỉ nhận message private để tránh các cá nhân không phận sự chạm đến `/checkin`.
3. Password IHR anh lưu được bảo mật an toàn cấp độ phần mềm dùng khóa `BOT_SECRET_KEY` bằng AES-256 nội tại. Do đó mất Database cũng không sợ lộ. Khóa `.env` là chìa khóa chính.
