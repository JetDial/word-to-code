/* Turns the language-neutral statement tree into source lines, and into a
   plain-English explanation.                                              */

import { LANGS, IND, indent, ex, fixCond } from './languages.js';

function emitBody(nodes, L) {
  const out = [];
  for (const n of nodes) out.push(...emitStmt(n, L));
  return out;
}

function blockLines(L, head, bodyNodes) {
  let body = emitBody(bodyNodes, L);
  if (L.style === 'py') {
    if (!body.length) body = ['pass'];
    return [head + ':', ...indent(body, 1)];
  }
  return [head + ' {', ...indent(body, 1), '}'];
}

function ifLines(L, n) {
  const cond = c => fixCond(c, L.style);
  if (L.style === 'py') {
    let body = emitBody(n.body, L);
    if (!body.length) body = ['pass'];
    const out = ['if ' + cond(n.cond) + ':', ...indent(body, 1)];
    for (const e of n.elifs ?? []) {
      out.push('elif ' + cond(e.cond) + ':', ...indent(emitBody(e.body, L), 1));
    }
    if (n.else) out.push('else:', ...indent(emitBody(n.else, L), 1));
    return out;
  }
  const head = c => 'if ' + (L.parens ? '(' + c + ')' : c);
  const out = [head(cond(n.cond)) + ' {', ...indent(emitBody(n.body, L), 1)];
  for (const e of n.elifs ?? []) {
    out.push('} else ' + head(cond(e.cond)) + ' {', ...indent(emitBody(e.body, L), 1));
  }
  if (n.else) out.push('} else {', ...indent(emitBody(n.else, L), 1));
  out.push('}');
  return out;
}

function emitStmt(n, L) {
  switch (n.t) {
    case 'print':   return [L.print(n.parts)];
    case 'var':     return [L.varDecl(n.name, n.e)];
    case 'assign':  return [L.assign(n.name, n.e)];
    case 'input':   return L.input(n.name, n.prompt);
    case 'comment': return [L.comment + ' ' + n.text];
    case 'unknown': return [L.comment + ' [not translated] ' + n.src];
    case 'for':     return blockLines(L, L.forHead(n.v, n.from, n.to), n.body);
    case 'while':   return blockLines(L, L.whileHead(fixCond(n.cond, L.style)), n.body);
    case 'if':      return ifLines(L, n);
    default:        return [];
  }
}

/** Walk the tree once to find out which imports/boilerplate the wrapper needs. */
function computeNeeds(nodes) {
  const needs = { input: false };
  (function walk(ns) {
    for (const n of ns) {
      if (n.t === 'input') needs.input = true;
      for (const key of ['body', 'else']) if (n[key]) walk(n[key]);
      for (const e of n.elifs ?? []) walk(e.body);
    }
  })(nodes);
  return needs;
}

export function countUnknown(nodes) {
  let c = 0;
  (function walk(ns) {
    for (const n of ns) {
      if (n.t === 'unknown') c++;
      for (const key of ['body', 'else']) if (n[key]) walk(n[key]);
      for (const e of n.elifs ?? []) walk(e.body);
    }
  })(nodes);
  return c;
}

/** Compile a statement tree into a complete, runnable program. */
export function buildProgram(nodes, target, pre) {
  const L = LANGS[target];
  if (!L) throw new Error('Unknown target language: ' + target);
  const preLines = pre?.[target] ?? [];
  return L.wrap(preLines, emitBody(nodes, L), computeNeeds(nodes)).join('\n');
}

/** Describe the tree in plain English, one bullet per meaningful step. */
export function explainNodes(nodes, out = []) {
  for (const n of nodes) {
    switch (n.t) {
      case 'print':
        out.push('Prints ' + n.parts
          .map(p => p.k === 'str' ? '"' + p.v + '"' : '`' + p.v + '`')
          .join(' + ') + '.');
        break;
      case 'var':
        out.push('Creates a variable `' + n.name + '` set to ' + ex(n.e) + '.');
        break;
      case 'assign':
        out.push('Updates `' + n.name + '` to ' + ex(n.e) + '.');
        break;
      case 'input':
        out.push('Asks the user for input and stores it in `' + n.name + '`.');
        break;
      case 'for':
        out.push('Loops `' + n.v + '` from ' + n.from + ' to ' + n.to + ' (inclusive), and inside the loop:');
        explainNodes(n.body, out);
        break;
      case 'while':
        out.push('Repeats while `' + n.cond + '`:');
        explainNodes(n.body, out);
        break;
      case 'if':
        out.push('If `' + n.cond + '`:');
        explainNodes(n.body, out);
        for (const e of n.elifs ?? []) {
          out.push('Else, if `' + e.cond + '`:');
          explainNodes(e.body, out);
        }
        if (n.else) { out.push('Otherwise:'); explainNodes(n.else, out); }
        break;
      case 'unknown':
        out.push('Could not translate this line (left as a comment): `' + n.src + '`');
        break;
    }
  }
  return out;
}

export { IND };
