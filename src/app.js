/* UI controller: wires the panels to the engines, persists preferences and
   history, and handles copy / save / keyboard shortcuts.                   */

import { LANGS } from './core/languages.js';
import { ruleFromDescription } from './core/nl.js';
import { ruleFromCode, READABLE_SOURCES } from './core/codeparse.js';
import { aiTranslate, browserTransport } from './core/ai.js';
import { highlight } from './core/highlight.js';
import * as store from './store.js';

const $ = sel => document.querySelector(sel);

const state = {
  engine: 'rule',
  tab: 'nl',
  results: { nl: null, code: null }
};

/* ------------------------------------------------------------ utilities */
function toast(msg) {
  const el = $('#toast');
  el.textContent = msg;
  el.classList.add('on');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => el.classList.remove('on'), 1800);
}

function fillLangSelect(sel, selected) {
  sel.innerHTML = '';
  for (const id of Object.keys(LANGS)) {
    const o = document.createElement('option');
    o.value = id;
    o.textContent = LANGS[id].label;
    if (id === selected) o.selected = true;
    sel.appendChild(o);
  }
}

function persist() {
  store.settings.set({
    engine: state.engine,
    tab: state.tab,
    nlTarget: $('#nl-target').value,
    codeSource: $('#code-source').value,
    codeTarget: $('#code-target').value
  });
}

/* ------------------------------------------------------------- rendering */
function renderResult(panel, r) {
  const err = $('#' + panel + '-err');
  const out = $('#' + panel + '-out');

  if (r.error) {
    err.textContent = r.error;
    err.classList.add('on');
    out.classList.remove('on');
    state.results[panel] = null;
    return false;
  }

  err.classList.remove('on');
  state.results[panel] = r;

  $('#' + panel + '-code').innerHTML = highlight(r.code, r.lang);
  $('#' + panel + '-langtag').textContent = LANGS[r.lang]?.label ?? r.lang;

  const assump = $('#' + panel + '-assump');
  if (r.assumptions?.length) {
    assump.textContent = 'Assumptions: ' + r.assumptions.join(' ');
    assump.hidden = false;
  } else {
    assump.hidden = true;
  }

  const ul = $('#' + panel + '-explain');
  ul.innerHTML = '';
  for (const line of r.explanation ?? []) {
    const li = document.createElement('li');
    li.textContent = line;
    ul.appendChild(li);
  }

  out.classList.add('on');
  return true;
}

/* --------------------------------------------------------------- history */
function renderHistory(items) {
  const list = $('#history-list');
  list.innerHTML = '';
  $('#history-empty').hidden = items.length > 0;

  for (const item of items) {
    const div = document.createElement('div');
    div.className = 'hist-item';
    div.tabIndex = 0;
    div.setAttribute('role', 'button');

    const meta = document.createElement('div');
    meta.className = 'hist-meta';
    const mode = document.createElement('span');
    mode.className = 'hist-badge';
    mode.textContent = item.mode === 'nl' ? 'describe' : (LANGS[item.source]?.label ?? item.source);
    const arrow = document.createElement('span');
    arrow.textContent = '→ ' + (LANGS[item.target]?.label ?? item.target);
    const when = document.createElement('span');
    when.className = 'hist-when';
    when.textContent = new Date(item.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    meta.append(mode, arrow, when);

    const text = document.createElement('div');
    text.className = 'hist-text';
    text.textContent = item.input;

    div.append(meta, text);
    const restore = () => restoreHistory(item);
    div.addEventListener('click', restore);
    div.addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); restore(); }
    });
    list.appendChild(div);
  }
}

function restoreHistory(item) {
  showTab(item.mode);
  if (item.mode === 'nl') {
    $('#nl-input').value = item.input;
    $('#nl-target').value = item.target;
  } else {
    $('#code-input').value = item.input;
    $('#code-source').value = item.source;
    $('#code-target').value = item.target;
  }
  renderResult(item.mode, {
    code: item.code,
    lang: item.target,
    assumptions: item.assumptions ?? [],
    explanation: item.explanation ?? []
  });
  persist();
  toast('Restored from history');
}

async function recordHistory(panel, input, r) {
  const entry = {
    mode: panel,
    engine: state.engine,
    input,
    target: r.lang,
    source: panel === 'code' ? $('#code-source').value : null,
    code: r.code,
    assumptions: r.assumptions ?? [],
    explanation: r.explanation ?? []
  };
  renderHistory(await store.history.add(entry));
}

/* ------------------------------------------------------------ translate */
async function run(panel) {
  const btn = $('#' + panel + '-go');
  const original = btn.innerHTML;
  let result;
  let input;

  if (panel === 'nl') {
    input = $('#nl-input').value.trim();
    if (!input) { toast('Describe what you want first'); return; }
    const target = $('#nl-target').value;
    if (state.engine === 'rule') {
      result = ruleFromDescription(input, target);
    } else {
      btn.disabled = true;
      btn.innerHTML = '<span class="spin"></span>Thinking…';
      try {
        result = await aiTranslate({ mode: 'nl', text: input, target }, transport());
      } catch (e) {
        result = { error: e.message };
      }
      btn.disabled = false;
      btn.innerHTML = original;
    }
  } else {
    input = $('#code-input').value.trim();
    if (!input) { toast('Paste some code first'); return; }
    const source = $('#code-source').value;
    const target = $('#code-target').value;
    if (source === target) { toast('Source and target are the same language'); return; }
    if (state.engine === 'rule') {
      result = ruleFromCode(input, source, target);
    } else {
      btn.disabled = true;
      btn.innerHTML = '<span class="spin"></span>Thinking…';
      try {
        result = await aiTranslate({ mode: 'code', text: input, source, target }, transport());
      } catch (e) {
        result = { error: e.message };
      }
      btn.disabled = false;
      btn.innerHTML = original;
    }
  }

  if (renderResult(panel, result)) await recordHistory(panel, input, result);
}

function transport() {
  return store.isDesktop
    ? store.desktopTransport()
    : browserTransport(() => $('#apikey').value);
}

/* ----------------------------------------------------------------- tabs */
function showTab(which) {
  state.tab = which;
  $('#tabbtn-nl').classList.toggle('on', which === 'nl');
  $('#tabbtn-code').classList.toggle('on', which === 'code');
  $('#panel-nl').classList.toggle('on', which === 'nl');
  $('#panel-code').classList.toggle('on', which === 'code');
  persist();
}

function setEngine(engine) {
  state.engine = engine;
  for (const b of document.querySelectorAll('#engine-pills button')) {
    b.classList.toggle('on', b.dataset.engine === engine);
  }
  $('#keyrow').classList.toggle('hidden', engine !== 'ai');
  persist();
}

/* ------------------------------------------------------------ copy/save */
async function copyPanel(panel) {
  const r = state.results[panel];
  if (!r) return;
  try {
    await navigator.clipboard.writeText(r.code);
    toast('Copied to clipboard');
  } catch {
    toast('Copy failed');
  }
}

async function savePanel(panel) {
  const r = state.results[panel];
  if (!r) { toast('Nothing to save yet'); return; }
  const ext = LANGS[r.lang]?.ext ?? 'txt';
  const base = r.lang === 'java' ? 'Main' : 'translated';
  const res = await store.saveFile(base + '.' + ext, r.code);
  if (res?.saved) toast('Saved');
}

/* ------------------------------------------------------------------ init */
async function init() {
  const saved = await store.settings.get();

  fillLangSelect($('#nl-target'), saved.nlTarget ?? 'python');
  fillLangSelect($('#code-source'), saved.codeSource ?? 'python');
  fillLangSelect($('#code-target'), saved.codeTarget ?? 'javascript');

  // The offline code parser can only read these; label the rest for AI mode.
  for (const opt of $('#code-source').options) {
    if (!READABLE_SOURCES.includes(opt.value)) opt.textContent += ' (AI mode only)';
  }

  setEngine(saved.engine ?? 'rule');
  showTab(saved.tab ?? 'nl');

  // API key
  const keyInput = $('#apikey');
  keyInput.value = await store.apiKey.get();
  const secure = await store.apiKey.isSecure();
  $('#keynote').textContent = store.isDesktop
    ? (secure
        ? 'Encrypted with your OS keychain and sent only to api.anthropic.com.'
        : 'Stored in this app’s data folder and sent only to api.anthropic.com.')
    : 'Stored only in this browser and sent only to api.anthropic.com.';
  let keyTimer;
  keyInput.addEventListener('input', () => {
    clearTimeout(keyTimer);
    keyTimer = setTimeout(() => store.apiKey.set(keyInput.value.trim()), 400);
  });

  renderHistory(await store.history.list());

  // Engine pills
  for (const b of document.querySelectorAll('#engine-pills button')) {
    b.addEventListener('click', () => setEngine(b.dataset.engine));
  }

  // Tabs
  $('#tabbtn-nl').addEventListener('click', () => showTab('nl'));
  $('#tabbtn-code').addEventListener('click', () => showTab('code'));

  // Translate
  $('#nl-go').addEventListener('click', () => run('nl'));
  $('#code-go').addEventListener('click', () => run('code'));

  // Language selects persist
  for (const id of ['#nl-target', '#code-source', '#code-target']) {
    $(id).addEventListener('change', persist);
  }

  // Swap languages
  $('#code-swap').addEventListener('click', () => {
    const s = $('#code-source'), t = $('#code-target');
    [s.value, t.value] = [t.value, s.value];
    persist();
  });

  // Copy / save
  for (const b of document.querySelectorAll('[data-copy]')) {
    b.addEventListener('click', () => copyPanel(b.dataset.copy));
  }
  for (const b of document.querySelectorAll('[data-save]')) {
    b.addEventListener('click', () => savePanel(b.dataset.save));
  }

  // History drawer
  $('#history-btn').addEventListener('click', () => {
    const hidden = $('#history').classList.toggle('hidden');
    $('#history-btn').classList.toggle('on', !hidden);
  });
  $('#history-clear').addEventListener('click', async () => {
    renderHistory(await store.history.clear());
    toast('History cleared');
  });

  // Keyboard shortcuts
  document.addEventListener('keydown', e => {
    const mod = e.ctrlKey || e.metaKey;
    if (!mod) return;
    if (e.key === 'Enter') { e.preventDefault(); run(state.tab); }
    else if (e.key === 's') { e.preventDefault(); savePanel(state.tab); }
    else if (e.key === 'h') { e.preventDefault(); $('#history-btn').click(); }
    else if (e.key === '1') { e.preventDefault(); showTab('nl'); }
    else if (e.key === '2') { e.preventDefault(); showTab('code'); }
  });
}

init();
