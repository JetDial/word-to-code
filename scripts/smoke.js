/* Headless-ish smoke test for the renderer: boots a hidden window, waits for
   the UI to initialize, exercises both engines through the real DOM, and
   reports pass/fail. Run with: npm run smoke                              */

import { app, BrowserWindow } from 'electron';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import { registerIpc } from '../electron/ipc.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');

const problems = [];
const consoleErrors = [];

// Run against a throwaway profile so the smoke test never touches real
// settings/history and always starts from a known-empty state.
const tmpProfile = fs.mkdtempSync(path.join(os.tmpdir(), 'w2c-smoke-'));
app.setPath('userData', tmpProfile);

app.on('window-all-closed', () => {});

app.whenReady().then(async () => {
  await registerIpc();

  const win = new BrowserWindow({
    show: false,
    width: 1200,
    height: 900,
    webPreferences: {
      preload: path.join(ROOT, 'electron', 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  win.webContents.on('console-message', event => {
    if (event.level === 'error' || event.level === 'warning') consoleErrors.push(event.message);
  });
  win.webContents.on('preload-error', (_e, p, err) => {
    problems.push('preload error in ' + p + ': ' + err.message);
  });

  await win.loadFile(path.join(ROOT, 'src', 'index.html'));

  // Give the module graph and init() a moment to settle.
  await new Promise(r => setTimeout(r, 900));

  const report = await win.webContents.executeJavaScript(`(() => {
    const $ = s => document.querySelector(s);
    const out = { steps: [] };

    // 1. Did the module graph load and populate the selects?
    out.langOptions = $('#nl-target').options.length;
    out.bridge = Boolean(window.desktop && window.desktop.isDesktop);

    // 2. Rule engine, describe -> code, through the real button.
    $('#nl-input').value = 'print the numbers from 1 to 10 and only the even ones';
    $('#nl-target').value = 'go';
    $('#nl-go').click();
    out.nlRendered = $('#nl-out').classList.contains('on');
    out.nlCode = $('#nl-code').textContent;
    out.nlHighlighted = $('#nl-code').innerHTML.includes('tk-kw');
    out.nlLangTag = $('#nl-langtag').textContent;

    // 3. Rule engine, code -> code.
    $('#tabbtn-code').click();
    out.tabSwitched = $('#panel-code').classList.contains('on');
    $('#code-input').value = 'total = 0\\nfor i in range(1, 5):\\n    total += i\\nprint(f"sum: {total}")';
    $('#code-source').value = 'python';
    $('#code-target').value = 'rust';
    $('#code-go').click();
    out.codeRendered = $('#code-out').classList.contains('on');
    out.codeCode = $('#code-code').textContent;

    // 4. Error path shows a message rather than stale output.
    $('#tabbtn-nl').click();
    $('#nl-input').value = 'zzz nonsense zzz';
    $('#nl-go').click();
    out.errShown = $('#nl-err').classList.contains('on');

    // 5. Swap button.
    $('#tabbtn-code').click();
    const beforeS = $('#code-source').value, beforeT = $('#code-target').value;
    $('#code-swap').click();
    out.swapWorks = $('#code-source').value === beforeT && $('#code-target').value === beforeS;

    return out;
  })()`);

  // Give the async history write a beat, then read it back through the bridge.
  await new Promise(r => setTimeout(r, 400));
  const histCount = await win.webContents.executeJavaScript(
    'document.querySelectorAll("#history-list .hist-item").length'
  );

  const check = (label, ok, detail = '') => {
    if (!ok) problems.push(label + (detail ? ' — ' + detail : ''));
  };

  check('language selects populated', report.langOptions === 8, 'got ' + report.langOptions);
  check('preload bridge exposed', report.bridge);
  check('describe->code rendered', report.nlRendered);
  check('go output looks right', /func main\(\)/.test(report.nlCode) && /i <= 10/.test(report.nlCode),
    JSON.stringify(report.nlCode.slice(0, 80)));
  check('syntax highlighting applied', report.nlHighlighted);
  check('language tag shown', report.nlLangTag === 'Go', report.nlLangTag);
  check('tab switch works', report.tabSwitched);
  check('code->code rendered', report.codeRendered);
  check('rust output looks right', /fn main\(\)/.test(report.codeCode), JSON.stringify(report.codeCode.slice(0, 80)));
  check('error path shows message', report.errShown);
  check('swap button works', report.swapWorks);
  check('history recorded entries', histCount >= 2, 'got ' + histCount);
  check('no console errors', consoleErrors.length === 0, consoleErrors.join(' | '));

  if (problems.length) {
    console.log('SMOKE FAILED:');
    for (const p of problems) console.log('  x ' + p);
  } else {
    console.log('SMOKE PASSED: renderer boots, both engines run, history persists, no console errors.');
  }

  app.exit(problems.length ? 1 : 0);
});
