import dotenv from 'dotenv';
dotenv.config({ override: true });
import { config } from '../src/config.js';
import { getHermesAccount, getUserAccount } from '../src/store.js';

const chatId = process.argv[2] || '1182254896';
const ihr = await getUserAccount({ secret: config.botSecretKey, chatId });
const hermes = await getHermesAccount({ secret: config.botSecretKey, chatId });
console.log(JSON.stringify({
  ihr: { user: ihr?.ihrUsername || null, hasPassword: Boolean(ihr?.ihrPassword), accidentallyHasHermes: Boolean(ihr?.hermesUsername) },
  hermes: { user: hermes?.hermesUsername || null, hasPassword: Boolean(hermes?.hermesPassword), accidentallyHasIhr: Boolean(hermes?.ihrUsername) }
}, null, 2));
