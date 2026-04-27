import dotenv from 'dotenv';
dotenv.config({ override: true });
import { config } from '../src/config.js';
import { getAllUserAccounts, getHermesAccount, saveHermesAccount } from '../src/store.js';

const accounts = await getAllUserAccounts({ secret: config.botSecretKey });
let migrated = 0;
for (const account of accounts) {
  if (!account.hermesUsername || !account.hermesPassword) {
    continue;
  }
  const existing = await getHermesAccount({ secret: config.botSecretKey, chatId: account.chatId });
  if (existing?.hermesUsername) {
    continue;
  }
  await saveHermesAccount({
    secret: config.botSecretKey,
    chatId: account.chatId,
    telegramUser: {
      id: account.telegramId,
      username: account.telegramUsername,
      first_name: account.telegramName || ''
    },
    hermesUsername: account.hermesUsername,
    hermesPassword: account.hermesPassword
  });
  migrated += 1;
}
console.log(`Migrated Hermes accounts: ${migrated}`);
