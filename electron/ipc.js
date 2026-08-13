/* Persistence + privileged operations, shared by the real app entry point and
   the smoke-test harness so both expose an identical bridge.              */

import { app, BrowserWindow, ipcMain, dialog, safeStorage } from 'electron';
import path from 'node:path';
import fs from 'node:fs/promises';

const HISTORY_LIMIT = 100;

let storePath;
let store = { settings: {}, history: [], apiKey: null };
let writeQueue = Promise.resolve();

async function loadStore() {
  storePath = path.join(app.getPath('userData'), 'store.json');
  try {
    const parsed = JSON.parse(await fs.readFile(storePath, 'utf8'));
    store = {
      settings: parsed.settings ?? {},
      history: Array.isArray(parsed.history) ? parsed.history : [],
      apiKey: typeof parsed.apiKey === 'string' ? parsed.apiKey : null
    };
  } catch {
    /* first run — keep defaults */
  }
}

function saveStore() {
  writeQueue = writeQueue
    .then(() => fs.writeFile(storePath, JSON.stringify(store, null, 2), 'utf8'))
    .catch(err => console.error('store write failed:', err));
  return writeQueue;
}

/* The key is encrypted at rest with the OS keychain/DPAPI where available, so
   it never sits on disk as plaintext the way a localStorage value would. */
function encryptKey(plain) {
  if (!plain) return null;
  if (!safeStorage.isEncryptionAvailable()) return 'plain:' + plain;
  return 'enc:' + safeStorage.encryptString(plain).toString('base64');
}

function decryptKey(stored) {
  if (!stored) return '';
  if (stored.startsWith('plain:')) return stored.slice(6);
  if (stored.startsWith('enc:')) {
    try {
      return safeStorage.decryptString(Buffer.from(stored.slice(4), 'base64'));
    } catch {
      return '';
    }
  }
  return '';
}

export async function registerIpc() {
  await loadStore();

  ipcMain.handle('settings:get', () => store.settings);

  ipcMain.handle('settings:set', (_e, patch) => {
    if (patch && typeof patch === 'object') {
      store.settings = { ...store.settings, ...patch };
      saveStore();
    }
    return store.settings;
  });

  ipcMain.handle('key:get', () => decryptKey(store.apiKey));

  ipcMain.handle('key:set', (_e, plain) => {
    store.apiKey = plain ? encryptKey(String(plain)) : null;
    saveStore();
    return true;
  });

  ipcMain.handle('key:secure', () => safeStorage.isEncryptionAvailable());

  ipcMain.handle('history:list', () => store.history);

  ipcMain.handle('history:add', (_e, entry) => {
    store.history.unshift({ ...entry, at: Date.now() });
    if (store.history.length > HISTORY_LIMIT) store.history.length = HISTORY_LIMIT;
    saveStore();
    return store.history;
  });

  ipcMain.handle('history:clear', () => {
    store.history = [];
    saveStore();
    return store.history;
  });

  ipcMain.handle('file:save', async (e, { suggestedName, content }) => {
    const win = BrowserWindow.fromWebContents(e.sender);
    const { canceled, filePath } = await dialog.showSaveDialog(win, {
      defaultPath: suggestedName || 'output.txt'
    });
    if (canceled || !filePath) return { saved: false };
    await fs.writeFile(filePath, content, 'utf8');
    return { saved: true, path: filePath };
  });

  /* Running the API call here means the request originates from Node, not a
     web page — no CORS preflight, and no browser-access escape-hatch header. */
  ipcMain.handle('ai:request', async (_e, body) => {
    const apiKey = decryptKey(store.apiKey);
    if (!apiKey) return { ok: false, status: 0, error: 'No API key saved.' };

    let res;
    try {
      res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
          'anthropic-beta': 'server-side-fallback-2026-07-01'
        },
        body: JSON.stringify(body)
      });
    } catch (err) {
      return { ok: false, status: 0, error: 'Network error: ' + err.message };
    }

    const text = await res.text();
    let data = null;
    try { data = JSON.parse(text); } catch { /* non-JSON error body */ }

    if (!res.ok) {
      return { ok: false, status: res.status, error: data?.error?.message ?? text.slice(0, 300) };
    }
    return { ok: true, data };
  });
}
