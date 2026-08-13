/* One storage surface for both builds.
   Desktop  -> Electron IPC (JSON file in app-data, API key encrypted at rest).
   Browser  -> localStorage.                                                  */

const D = globalThis.desktop;
export const isDesktop = Boolean(D?.isDesktop);

const LS_SETTINGS = 'w2c.settings';
const LS_HISTORY = 'w2c.history';
const LS_KEY = 'w2c.apikey';
const HISTORY_LIMIT = 100;

function lsRead(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}
function lsWrite(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* quota / private mode */ }
}

export const settings = {
  async get() {
    return isDesktop ? await D.settings.get() : lsRead(LS_SETTINGS, {});
  },
  async set(patch) {
    if (isDesktop) return D.settings.set(patch);
    const next = { ...lsRead(LS_SETTINGS, {}), ...patch };
    lsWrite(LS_SETTINGS, next);
    return next;
  }
};

export const apiKey = {
  async get() {
    return isDesktop ? await D.key.get() : (localStorage.getItem(LS_KEY) ?? '');
  },
  async set(plain) {
    if (isDesktop) return D.key.set(plain);
    try {
      if (plain) localStorage.setItem(LS_KEY, plain);
      else localStorage.removeItem(LS_KEY);
    } catch { /* ignore */ }
    return true;
  },
  async isSecure() {
    return isDesktop ? await D.key.isSecure() : false;
  }
};

export const history = {
  async list() {
    return isDesktop ? await D.history.list() : lsRead(LS_HISTORY, []);
  },
  async add(entry) {
    if (isDesktop) return D.history.add(entry);
    const next = [{ ...entry, at: Date.now() }, ...lsRead(LS_HISTORY, [])].slice(0, HISTORY_LIMIT);
    lsWrite(LS_HISTORY, next);
    return next;
  },
  async clear() {
    if (isDesktop) return D.history.clear();
    lsWrite(LS_HISTORY, []);
    return [];
  }
};

/** Save text to disk: a real dialog on desktop, a download in the browser. */
export async function saveFile(suggestedName, content) {
  if (isDesktop) return D.saveFile(suggestedName, content);
  const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = suggestedName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return { saved: true, path: suggestedName };
}

/** Desktop routes the API call through the main process, dodging CORS entirely. */
export function desktopTransport() {
  return body => D.aiRequest(body);
}
