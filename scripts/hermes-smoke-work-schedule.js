import dotenv from 'dotenv';
dotenv.config({ override: true });
import { config } from '../src/config.js';
import { getHermesAccount } from '../src/store.js';
import { getWorkScheduleByDay, parseWorkScheduleDateInput } from '../src/hermesClient.js';

const chatId = process.argv[2] || '1182254896';
const dates = process.argv.slice(3).length ? process.argv.slice(3) : ['2026-04-27','2026-04-28','2026-04-29','2026-04-30','2026-05-01','2026-05-02','2026-05-03'];
const account = await getHermesAccount({ secret: config.botSecretKey, chatId });
if (!account?.hermesUsername || !account?.hermesPassword) throw new Error('Missing Hermes account');
for (const raw of dates) {
  const result = await getWorkScheduleByDay({
    username: account.hermesUsername,
    password: account.hermesPassword,
    storageState: account.hermesSession,
    date: parseWorkScheduleDateInput(raw)
  });
  console.log('\nDATE', raw, 'ok=', result.ok, 'count=', result.entries?.length || 0, 'expired=', result.sessionExpired || false);
  if (!result.ok) console.log(result.message);
  for (const entry of result.entries || []) console.log('-', entry.date, entry.type, entry.ticket, entry.status, '|', entry.text);
}
