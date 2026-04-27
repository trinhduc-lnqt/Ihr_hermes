import { parseWorkScheduleDateInput } from '../src/hermesClient.js';
import { config } from '../src/config.js';
function toLocal(date) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: config.timezoneId, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date);
  const v = Object.fromEntries(parts.map(p => [p.type, p.value]));
  return `${v.year}-${v.month}-${v.day}`;
}
function add(date, days) {
  const [y,m,d] = toLocal(date).split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + days, 12, 0, 0));
}
function week(date) {
  const [y,m,d] = toLocal(date).split('-').map(Number);
  const local = new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
  const dow = local.getUTCDay() || 7;
  const s = add(local, 1 - dow);
  return [toLocal(s), toLocal(add(s, 6))];
}
for (const d of ['2026-04-27','2026-04-28','2026-04-29','2026-05-03']) {
  const parsed = parseWorkScheduleDateInput(d);
  console.log(d, toLocal(parsed), week(parsed).join(' -> '));
}
