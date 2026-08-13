/* Offline engine 2: read a subset of Python or JavaScript into the same
   statement tree the natural-language engine produces, so any target
   emitter can render it.                                                  */

import { buildProgram, explainNodes, countUnknown } from './emit.js';
import { LANGS, minusOne } from './languages.js';

/** Classify a literal: string, number, or opaque expression. */
export function parseVal(s) {
  s = String(s).trim().replace(/;$/, '');
  if (/^-?\d+(\.\d+)?$/.test(s)) return { k: 'num', v: s };
  let m;
  if ((m = s.match(/^"((?:\\.|[^"\\])*)"$/)) ||
      (m = s.match(/^'((?:\\.|[^'\\])*)'$/)) ||
      (m = s.match(/^`((?:\\.|[^`\\$])*)`$/))) {
    return { k: 'str', v: m[1] };
  }
  return { k: 'raw', v: s };
}

/** Split on commas that sit at bracket depth 0 and outside quotes. */
export function splitTop(s) {
  const out = [];
  let depth = 0, cur = '', quote = null;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (quote) {
      cur += ch;
      if (ch === quote && s[i - 1] !== '\\') quote = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') { quote = ch; cur += ch; continue; }
    if ('([{'.includes(ch)) depth++;
    if (')]}'.includes(ch)) depth--;
    if (ch === ',' && depth === 0) { out.push(cur.trim()); cur = ''; continue; }
    cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

/** Split an interpolated string into literal and expression parts. */
function interpParts(text, openRe) {
  const parts = [];
  let last = 0, m;
  while ((m = openRe.exec(text))) {
    if (m.index > last) parts.push({ k: 'str', v: text.slice(last, m.index) });
    parts.push({ k: 'raw', v: m[1].trim() });
    last = m.index + m[0].length;
  }
  if (last < text.length) parts.push({ k: 'str', v: text.slice(last) });
  return parts.length ? parts : [{ k: 'str', v: '' }];
}

/** print() puts a space between comma-separated arguments; console.log too. */
function joinWithSpaces(args) {
  if (args.length <= 1) return args.length ? args : [{ k: 'str', v: '' }];
  const joined = [];
  args.forEach((a, i) => {
    if (i) joined.push({ k: 'str', v: ' ' });
    joined.push(a);
  });
  return joined;
}

function parsePyArgs(argstr) {
  argstr = argstr.trim();
  let m;
  if ((m = argstr.match(/^f"((?:\\.|[^"\\])*)"$/)) ||
      (m = argstr.match(/^f'((?:\\.|[^'\\])*)'$/))) {
    return interpParts(m[1], /\{([^}]+)\}/g);
  }
  return joinWithSpaces(splitTop(argstr).map(parseVal));
}

function parseJsArgs(argstr) {
  argstr = argstr.trim();
  const m = argstr.match(/^`((?:\\.|[^`\\])*)`$/);
  if (m) return interpParts(m[1], /\$\{([^}]+)\}/g);
  return joinWithSpaces(splitTop(argstr).map(parseVal));
}

function compoundAssign(name, op, rhs) {
  return { t: 'assign', name, e: { k: 'raw', v: name + ' ' + op + ' ' + rhs.trim().replace(/;$/, '') } };
}

/* ---------------------------------------------------------------- Python */
export function parsePython(src) {
  const root = [], notes = [], declared = new Set();
  const frames = [{ indent: -1, body: root }];

  for (const rawLine of src.split('\n')) {
    if (!rawLine.trim()) continue;
    const indentLen = rawLine.match(/^\s*/)[0].replace(/\t/g, '    ').length;
    const line = rawLine.trim();
    while (frames.length > 1 && indentLen <= frames[frames.length - 1].indent) frames.pop();
    const top = frames[frames.length - 1];
    let m;

    if ((m = line.match(/^elif\s+(.+):$/))) {
      const last = top.body[top.body.length - 1];
      if (last?.t === 'if') {
        last.elifs ??= [];
        const e = { cond: m[1], body: [] };
        last.elifs.push(e);
        frames.push({ indent: indentLen, body: e.body });
      } else {
        top.body.push({ t: 'unknown', src: line });
      }
      continue;
    }
    if (/^else\s*:$/.test(line)) {
      const last = top.body[top.body.length - 1];
      if (last?.t === 'if') {
        last.else = [];
        frames.push({ indent: indentLen, body: last.else });
      } else {
        top.body.push({ t: 'unknown', src: line });
      }
      continue;
    }
    if ((m = line.match(/^#\s?(.*)$/))) { top.body.push({ t: 'comment', text: m[1] }); continue; }
    if ((m = line.match(/^print\((.*)\)$/))) { top.body.push({ t: 'print', parts: parsePyArgs(m[1]) }); continue; }

    if ((m = line.match(/^for\s+(\w+)\s+in\s+range\((.*)\)\s*:$/))) {
      const args = splitTop(m[2]);
      let node = null;
      if (args.length === 1) node = { t: 'for', v: m[1], from: '0', to: minusOne(args[0]), body: [] };
      else if (args.length === 2) node = { t: 'for', v: m[1], from: args[0], to: minusOne(args[1]), body: [] };
      if (node) {
        top.body.push(node);
        frames.push({ indent: indentLen, body: node.body });
      } else {
        top.body.push({ t: 'unknown', src: line });
        notes.push('range() with a step is not supported by the rule engine.');
      }
      continue;
    }
    if ((m = line.match(/^while\s+(.+):$/))) {
      const node = { t: 'while', cond: m[1], body: [] };
      top.body.push(node);
      frames.push({ indent: indentLen, body: node.body });
      continue;
    }
    if ((m = line.match(/^if\s+(.+):$/))) {
      const node = { t: 'if', cond: m[1], body: [] };
      top.body.push(node);
      frames.push({ indent: indentLen, body: node.body });
      continue;
    }
    if ((m = line.match(/^(\w+)\s*=\s*input\((.*)\)$/))) {
      declared.add(m[1]);
      const p = parseVal(m[2] || '""');
      top.body.push({ t: 'input', name: m[1], prompt: p.k === 'str' ? p.v : '' });
      continue;
    }
    if ((m = line.match(/^(\w+)\s*([+\-*/])?=(?!=)\s*(.+)$/))) {
      const [, name, op, rhs] = m;
      if (op) { top.body.push(compoundAssign(name, op, rhs)); continue; }
      if (declared.has(name)) top.body.push({ t: 'assign', name, e: parseVal(rhs) });
      else { declared.add(name); top.body.push({ t: 'var', name, e: parseVal(rhs) }); }
      continue;
    }
    top.body.push({ t: 'unknown', src: line });
  }
  return { nodes: root, notes };
}

/* ------------------------------------------------------------ JavaScript */
export function parseJS(src) {
  const root = [], notes = [], declared = new Set();
  const stack = [{ body: root, node: null }];

  for (const rawLine of src.split('\n')) {
    const line = rawLine.trim();
    if (!line) continue;
    const top = stack[stack.length - 1];
    let m;

    if (line === '}') { if (stack.length > 1) stack.pop(); continue; }
    if (/^\}\s*else\s*\{$/.test(line)) {
      const frame = stack.pop();
      const ifNode = frame?.node;
      if (ifNode?.t === 'if') {
        ifNode.else = [];
        stack.push({ body: ifNode.else, node: ifNode });
      }
      continue;
    }
    if ((m = line.match(/^\}\s*else\s+if\s*\((.*)\)\s*\{$/))) {
      const frame = stack.pop();
      const ifNode = frame?.node;
      if (ifNode?.t === 'if') {
        ifNode.elifs ??= [];
        const e = { cond: m[1], body: [] };
        ifNode.elifs.push(e);
        stack.push({ body: e.body, node: ifNode });
      }
      continue;
    }
    if ((m = line.match(/^\/\/\s?(.*)$/))) { top.body.push({ t: 'comment', text: m[1] }); continue; }
    if ((m = line.match(/^console\.log\((.*)\);?$/))) {
      top.body.push({ t: 'print', parts: parseJsArgs(m[1]) });
      continue;
    }
    if ((m = line.match(/^for\s*\(\s*(?:let|var|const)?\s*(\w+)\s*=\s*([^;]+);\s*\1\s*(<=|<)\s*([^;]+);\s*\1\s*\+\+\s*\)\s*\{$/))) {
      const to = m[3] === '<' ? minusOne(m[4].trim()) : m[4].trim();
      const node = { t: 'for', v: m[1], from: m[2].trim(), to, body: [] };
      top.body.push(node);
      stack.push({ body: node.body, node });
      continue;
    }
    if ((m = line.match(/^while\s*\((.*)\)\s*\{$/))) {
      const node = { t: 'while', cond: m[1], body: [] };
      top.body.push(node);
      stack.push({ body: node.body, node });
      continue;
    }
    if ((m = line.match(/^if\s*\((.*)\)\s*\{$/))) {
      const node = { t: 'if', cond: m[1], body: [] };
      top.body.push(node);
      stack.push({ body: node.body, node });
      continue;
    }
    if ((m = line.match(/^(?:let|const|var)\s+([A-Za-z_]\w*)\s*=\s*(.+?);?$/))) {
      declared.add(m[1]);
      top.body.push({ t: 'var', name: m[1], e: parseVal(m[2]) });
      continue;
    }
    if ((m = line.match(/^([A-Za-z_]\w*)\+\+;?$/))) {
      top.body.push({ t: 'assign', name: m[1], e: { k: 'raw', v: m[1] + ' + 1' } });
      continue;
    }
    if ((m = line.match(/^([A-Za-z_]\w*)\s*([+\-*/])?=(?!=)\s*(.+?);?$/))) {
      const [, name, op, rhs] = m;
      if (op) { top.body.push(compoundAssign(name, op, rhs)); continue; }
      if (declared.has(name)) top.body.push({ t: 'assign', name, e: parseVal(rhs) });
      else { declared.add(name); top.body.push({ t: 'var', name, e: parseVal(rhs) }); }
      continue;
    }
    top.body.push({ t: 'unknown', src: line });
  }
  return { nodes: root, notes };
}

export const READABLE_SOURCES = ['python', 'javascript'];

/** Translate `src` from `sourceLang` into `target`. */
export function ruleFromCode(src, sourceLang, target) {
  let parsed;
  if (sourceLang === 'python') parsed = parsePython(src);
  else if (sourceLang === 'javascript') parsed = parseJS(src);
  else {
    return {
      error: 'The offline rule engine can only read Python or JavaScript as the source ' +
        'language. Switch to Claude AI mode to translate from ' +
        (LANGS[sourceLang]?.label ?? sourceLang) + '.'
    };
  }
  if (!parsed.nodes.length) return { error: 'No code found in the input.' };

  const assumptions = [...parsed.notes];
  const unknowns = countUnknown(parsed.nodes);
  if (unknowns) {
    assumptions.push(unknowns + ' line(s) could not be understood and were left as comments. ' +
      'The rule engine only handles prints, variables, for/while/if and comments — ' +
      'Claude AI mode handles full programs.');
  }
  assumptions.push('Arithmetic and conditions were copied as-is; they work across these ' +
    'languages for simple expressions.');

  return {
    code: buildProgram(parsed.nodes, target),
    lang: target,
    assumptions,
    explanation: explainNodes(parsed.nodes)
  };
}
