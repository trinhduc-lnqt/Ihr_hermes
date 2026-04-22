import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { decryptText, encryptText } from "./crypto.js";

const dataDir = path.resolve("data");
const usersFile = path.join(dataDir, "users.json");

async function ensureDataDir() {
  await mkdir(dataDir, { recursive: true });
}

async function loadRawData() {
  await ensureDataDir();
  try {
    const content = await readFile(usersFile, "utf8");
    return JSON.parse(content);
  } catch (error) {
    if (error.code === "ENOENT") {
      return { users: {} };
    }
    throw error;
  }
}

async function saveRawData(data) {
  await ensureDataDir();
  await writeFile(usersFile, JSON.stringify(data, null, 2), "utf8");
}

export async function saveUserAccount({ secret, chatId, telegramUser, ihrUsername, ihrPassword }) {
  const data = await loadRawData();
  const now = new Date().toISOString();
  data.users[String(chatId)] = {
    chatId: String(chatId),
    telegramId: telegramUser?.id ? String(telegramUser.id) : null,
    telegramUsername: telegramUser?.username || null,
    telegramName: [telegramUser?.first_name, telegramUser?.last_name].filter(Boolean).join(" ") || null,
    ihrUsername,
    ihrPassword: encryptText(secret, ihrPassword),
    updatedAt: now,
    createdAt: data.users[String(chatId)]?.createdAt || now
  };
  await saveRawData(data);
  return data.users[String(chatId)];
}

export async function getUserAccount({ secret, chatId }) {
  const data = await loadRawData();
  const record = data.users[String(chatId)];
  if (!record) {
    return null;
  }
  return {
    ...record,
    ihrPassword: decryptText(secret, record.ihrPassword)
  };
}

export async function deleteUserAccount(chatId) {
  const data = await loadRawData();
  const key = String(chatId);
  if (!data.users[key]) {
    return false;
  }
  delete data.users[key];
  await saveRawData(data);
  return true;
}

export async function markSalaryNotified(chatId, monthLabel) {
  const data = await loadRawData();
  const key = String(chatId);
  if (!data.users[key]) {
    return false;
  }
  data.users[key].salaryLastNotifiedMonth = String(monthLabel || "");
  data.users[key].salaryLastNotifiedAt = new Date().toISOString();
  await saveRawData(data);
  return true;
}

export async function getAllUserAccounts({ secret }) {
  const data = await loadRawData();
  return Object.values(data.users || {}).map((record) => ({
    ...record,
    ihrPassword: decryptText(secret, record.ihrPassword)
  }));
}
