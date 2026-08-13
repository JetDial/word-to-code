/* Claude-powered engine. Prompt construction and response parsing are pure
   functions so they can be tested without a network; the transport is
   injected (Electron IPC in the desktop app, fetch in a plain browser).   */

import { LANGS } from './languages.js';

export const MODEL = 'claude-opus-5';
export const API_URL = 'https://api.anthropic.com/v1/messages';

const FORMAT = [
  'Respond in EXACTLY this format:',
  'ASSUMPTIONS: <assumptions you made, or "none">',
  '```<language>',
  '<complete runnable code>',
  '```',
  'EXPLANATION:',
  '- <one bullet per meaningful line or section>'
].join('\n');

/** Build the request body for either translation mode. */
export function buildRequest(opts) {
  const targetLabel = LANGS[opts.target]?.label ?? opts.target;
  let system, user;

  if (opts.mode === 'nl') {
    system =
      'You translate plain-language program descriptions into code. The description may be ' +
      'written in any human language.\n' + FORMAT + '\n' +
      'Write complete, runnable, idiomatic ' + targetLabel + ' code. Keep it minimal — ' +
      'implement only what was asked.\n' +
      'If the request cannot be expressed as a program, respond with only: ' +
      'NOT_CODE: <one short sentence explaining why>';
    user = 'Target language: ' + targetLabel + '\n\nDescription:\n' + opts.text;
  } else {
    const sourceLabel = LANGS[opts.source]?.label ?? opts.source;
    system =
      'You translate source code from one programming language to another, preserving ' +
      'behavior exactly and using idiomatic style in the target language.\n' + FORMAT + '\n' +
      'If the input is not code you can translate, respond with only: ' +
      'NOT_CODE: <one short sentence explaining why>';
    user = 'Source language: ' + sourceLabel + '\nTarget language: ' + targetLabel +
      '\n\nSource code:\n```\n' + opts.text + '\n```';
  }

  return {
    model: MODEL,
    max_tokens: 8000,
    fallbacks: 'default',
    system,
    messages: [{ role: 'user', content: user }]
  };
}

/** Pull the code, assumptions and explanation out of the model's reply. */
export function parseAiText(text, target) {
  const trimmed = String(text).trim();

  if (/^NOT_CODE:/.test(trimmed)) {
    return {
      error: "That doesn't look like something that can be turned into code — " +
        trimmed.replace(/^NOT_CODE:\s*/, '')
    };
  }

  const fence = trimmed.match(/```[\w+#-]*\n([\s\S]*?)```/);
  if (!fence) {
    return { error: 'Unexpected response format from the model:\n' + trimmed.slice(0, 300) };
  }
  const code = fence[1].replace(/\n$/, '');

  let assumptions = [];
  const am = trimmed.match(/^ASSUMPTIONS:\s*(.*)$/m);
  if (am && am[1].trim() && !/^none\.?$/i.test(am[1].trim())) assumptions = [am[1].trim()];

  let explanation = [];
  const ei = trimmed.indexOf('EXPLANATION:');
  if (ei !== -1) {
    explanation = trimmed
      .slice(ei + 'EXPLANATION:'.length)
      .split('\n')
      .map(l => l.replace(/^\s*[-*]\s*/, '').trim())
      .filter(Boolean);
  }

  return { code, lang: target, assumptions, explanation };
}

/** Interpret a successful API envelope. */
export function readEnvelope(data, target) {
  if (data?.stop_reason === 'refusal') {
    return { error: 'The model declined this request.' };
  }
  const text = (data?.content ?? [])
    .filter(b => b.type === 'text')
    .map(b => b.text)
    .join('')
    .trim();
  if (data?.stop_reason === 'max_tokens' && !/```/.test(text)) {
    return { error: 'The response was too long and got cut off — try a smaller request.' };
  }
  if (!text) return { error: 'The model returned an empty response.' };
  return parseAiText(text, target);
}

/**
 * Translate via Claude.
 * `transport(body)` must resolve to `{ ok, data }` or `{ ok:false, status, error }`.
 */
export async function aiTranslate(opts, transport) {
  const res = await transport(buildRequest(opts));

  if (!res.ok) {
    let msg = res.error || 'Request failed';
    if (res.status === 401) msg += ' — check that your API key is valid.';
    if (res.status === 429) msg += ' — rate limited; wait a moment and retry.';
    if (res.status >= 500) msg += ' — the API is having trouble; retry shortly.';
    return { error: msg };
  }
  return readEnvelope(res.data, opts.target);
}

/** Browser transport: talks to the API directly, which needs the CORS opt-in header. */
export function browserTransport(getKey) {
  return async body => {
    const key = (getKey() || '').trim();
    if (!key) {
      return { ok: false, status: 0, error: 'Enter your Anthropic API key to use Claude AI mode.' };
    }
    let res;
    try {
      res = await fetch(API_URL, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': key,
          'anthropic-version': '2023-06-01',
          'anthropic-beta': 'server-side-fallback-2026-07-01',
          'anthropic-dangerous-direct-browser-access': 'true'
        },
        body: JSON.stringify(body)
      });
    } catch (err) {
      return { ok: false, status: 0, error: 'Network error: ' + err.message };
    }
    const text = await res.text();
    let data = null;
    try { data = JSON.parse(text); } catch { /* non-JSON body */ }
    if (!res.ok) {
      return { ok: false, status: res.status, error: data?.error?.message || text.slice(0, 300) };
    }
    return { ok: true, data };
  };
}
