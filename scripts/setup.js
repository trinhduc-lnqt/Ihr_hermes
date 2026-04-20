import fs from 'fs/promises';
import path from 'path';
import readline from 'readline/promises';
import crypto from 'crypto';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');
const envPath = path.join(rootDir, '.env');
const envExamplePath = path.join(rootDir, '.env.example');

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

async function setup() {
  console.log('--- iHR Telegram Bot Setup ---');
  console.log('Chào mừng anh đến với trình cài đặt bot!');

  // Check if .env exists
  let existingEnv = {};
  try {
    const content = await fs.readFile(envPath, 'utf-8');
    content.split('\n').forEach(line => {
      const [key, value] = line.split('=');
      if (key && value) existingEnv[key.trim()] = value.trim();
    });
    const confirm = await rl.question('.env đã tồn tại. Anh có muốn ghi đè không? (y/n): ');
    if (confirm.toLowerCase() !== 'y') {
      console.log('Hủy bỏ cài đặt.');
      process.exit(0);
    }
  } catch (err) {
    // .env doesn't exist, proceed
  }

  const botToken = await rl.question('1. Nhập Telegram Bot Token (lấy từ @BotFather): ');
  const adminId = await rl.question('2. Nhập Telegram ID của Admin (để quản lý bot): ');
  
  const suggestedSecret = crypto.randomBytes(32).toString('hex');
  const secretKey = await rl.question(`3. Nhập Secret Key (Để trống để dùng mã ngẫu nhiên: ${suggestedSecret.substring(0, 10)}...): `) || suggestedSecret;

  const machineName = await rl.question('4. Nhập tên máy chạy bot (Ví dụ: VPS-GCP-Hanoi): ') || 'MyBotMachine';
  
  const wgTunnel = await rl.question('5. Nhập tên WireGuard Tunnel (Nếu dùng VPN, không thì để trống): ');

  // Read .env.example
  let exampleContent = '';
  try {
    exampleContent = await fs.readFile(envExamplePath, 'utf-8');
  } catch (err) {
    console.error('Lỗi: Không tìm thấy file .env.example để làm mẫu!');
    process.exit(1);
  }

  const replacements = {
    'TELEGRAM_BOT_TOKEN': botToken,
    'ALLOWED_TELEGRAM_IDS': adminId,
    'BOT_SECRET_KEY': secretKey,
    'BOT_MACHINE_NAME': machineName,
    'WG_TUNNEL_NAME': wgTunnel,
  };

  let newEnvContent = exampleContent;
  for (const [key, value] of Object.entries(replacements)) {
    const regex = new RegExp(`^${key}=.*`, 'm');
    if (newEnvContent.match(regex)) {
      newEnvContent = newEnvContent.replace(regex, `${key}=${value}`);
    } else {
      newEnvContent += `\n${key}=${value}`;
    }
  }

  // Create data directory if not exists
  const dataDir = path.join(rootDir, 'data');
  try {
    await fs.mkdir(dataDir, { recursive: true });
    // Create empty users.json if not exists
    const usersJsonPath = path.join(dataDir, 'users.json');
    try {
      await fs.access(usersJsonPath);
    } catch {
      await fs.writeFile(usersJsonPath, JSON.stringify({ users: {} }, null, 2));
      console.log('Đã tạo file data/users.json trống.');
    }
    
    // Create empty allowed-telegram-ids.txt if not exists
    const allowedIdsPath = path.join(dataDir, 'allowed-telegram-ids.txt');
    try {
      await fs.access(allowedIdsPath);
    } catch {
      await fs.writeFile(allowedIdsPath, adminId);
      console.log('Đã tạo file data/allowed-telegram-ids.txt với ID admin.');
    }
  } catch (err) {
    console.error('Lỗi khi chuẩn bị thư mục data:', err);
  }

  await fs.writeFile(envPath, newEnvContent);
  console.log('\n✅ Cài đặt hoàn tất! File .env đã được tạo thành công.');
  console.log('Bây giờ anh có thể chạy bot bằng lệnh: npm run bot');

  rl.close();
}

setup();
