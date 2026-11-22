/**
 * Veo3 account store.
 * Persists accounts (one Chrome profile each) to a JSON file in userData.
 */
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

import { createRequire } from 'module';

// Module ESM không có `require` sẵn: dựng bằng createRequire. Trước đây thiếu bước này nên luôn rơi về thư mục dự án
// (dữ liệu Chrome + cookie Google nằm lẫn trong repo). Chạy ngoài Electron (vd. test) thì dùng thư mục hiện tại.
let electronApp = null;
try {
  const electron = createRequire(import.meta.url)('electron');
  electronApp = electron && electron.app ? electron.app : null;
} catch {
  electronApp = null;
}

function getBaseDir() {
  const base = electronApp ? electronApp.getPath('userData') : path.resolve('.');
  const dir = path.join(base, 'veo3');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export function getProfilesDir() {
  const dir = path.join(getBaseDir(), 'profiles');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function getStoreFile() {
  return path.join(getBaseDir(), 'accounts.json');
}

function readStore() {
  const file = getStoreFile();
  try {
    if (fs.existsSync(file)) {
      const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (parsed && Array.isArray(parsed.accounts)) return parsed;
    }
  } catch {
    /* ignore corrupt file */
  }
  return { accounts: [], activeAccountId: null };
}

function writeStore(store) {
  fs.writeFileSync(getStoreFile(), JSON.stringify(store, null, 2), 'utf8');
}

export function listAccounts() {
  return readStore().accounts;
}

export function getActiveAccount() {
  const store = readStore();
  return store.accounts.find((a) => a.id === store.activeAccountId) ?? store.accounts[0] ?? null;
}

export function getAccount(accountId) {
  return readStore().accounts.find((a) => a.id === accountId) ?? null;
}

export function addAccount({ name } = {}) {
  const store = readStore();
  const id = crypto.randomUUID();
  const account = {
    id,
    name: name?.trim() || `Account ${store.accounts.length + 1}`,
    email: '',
    profileDir: path.join(getProfilesDir(), `veo3-${id}`),
    lastLoginStatus: 'unknown',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  store.accounts.push(account);
  if (!store.activeAccountId) store.activeAccountId = id;
  writeStore(store);
  return account;
}

export function updateAccount(accountId, patch) {
  const store = readStore();
  const account = store.accounts.find((a) => a.id === accountId);
  if (!account) return null;
  Object.assign(account, patch, { updatedAt: new Date().toISOString() });
  writeStore(store);
  return account;
}

export function setActiveAccount(accountId) {
  const store = readStore();
  if (!store.accounts.some((a) => a.id === accountId)) return false;
  store.activeAccountId = accountId;
  writeStore(store);
  return true;
}

export function deleteAccount(accountId) {
  const store = readStore();
  const account = store.accounts.find((a) => a.id === accountId);
  store.accounts = store.accounts.filter((a) => a.id !== accountId);
  if (store.activeAccountId === accountId) {
    store.activeAccountId = store.accounts[0]?.id ?? null;
  }
  writeStore(store);
  // Best-effort remove profile dir
  if (account?.profileDir) {
    try {
      fs.rmSync(account.profileDir, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  }
  return true;
}
