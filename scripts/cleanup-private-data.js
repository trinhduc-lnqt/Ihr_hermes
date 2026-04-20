import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');

async function cleanup() {
  console.log('--- Cleaning Private Data for Sharing ---');
  
  const targets = [
    path.join(rootDir, '.env'),
    path.join(rootDir, 'data', 'users.json'),
    path.join(rootDir, 'data', 'allowed-telegram-ids.txt'),
    path.join(rootDir, 'logs'),
  ];

  for (const target of targets) {
    try {
      const stats = await fs.stat(target);
      if (stats.isDirectory()) {
        await fs.rm(target, { recursive: true, force: true });
        console.log(`🗑️ Đã xóa thư mục: ${path.relative(rootDir, target)}`);
      } else {
        await fs.unlink(target);
        console.log(`🗑️ Đã xóa file: ${path.relative(rootDir, target)}`);
      }
    } catch (err) {
      // File or directory doesn't exist, ignore
    }
  }

  // Restore empty placeholders
  try {
    const dataDir = path.join(rootDir, 'data');
    await fs.mkdir(dataDir, { recursive: true });
    
    await fs.writeFile(path.join(dataDir, 'users.json'), JSON.stringify({ users: {} }, null, 2));
    console.log('✨ Đã tạo lại data/users.json trống.');
    
    console.log('\n✅ Dọn dẹp hoàn tất. Project hiện đã sạch thông tin cá nhân và sẵn sàng để nén/chia sẻ.');
  } catch (err) {
    console.error('Lỗi khi khôi phục template:', err);
  }
}

cleanup();
