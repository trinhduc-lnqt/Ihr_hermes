import { parseWorkScheduleDateInput } from '../src/hermesClient.js';
const dates = ['2026-04-27','2026-04-28','2026-04-29','2026-05-03'];
for (const d of dates) console.log(d, parseWorkScheduleDateInput(d)?.toISOString());
