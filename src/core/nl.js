/* Offline engine 1: plain-language description -> statement tree.
   Non-English input is normalized to English keywords first, so the same
   intent patterns serve every supported human language.                   */

import { buildProgram, explainNodes } from './emit.js';
import { IND } from './languages.js';

/** Keyword bridges for Spanish, French, German and Portuguese. */
const WORDMAP = {
  imprime: 'print', imprimir: 'print', muestra: 'print', mostrar: 'print',
  escribe: 'print', escribir: 'print',
  affiche: 'print', afficher: 'print', ecris: 'print', ecrire: 'print',
  drucke: 'print', ausgeben: 'print', zeige: 'print', schreibe: 'print',
  imprima: 'print', mostre: 'print', escreva: 'print',
  numeros: 'numbers', zahlen: 'numbers',
  desde: 'from', von: 'from', depuis: 'from',
  hasta: 'to', jusqu: 'to', bis: 'to', ate: 'to', al: 'to', au: 'to',
  pares: 'even', par: 'even', pairs: 'even', pair: 'even', gerade: 'even',
  impares: 'odd', impar: 'odd', impairs: 'odd', impair: 'odd', ungerade: 'odd',
  crea: 'create', crear: 'create', cree: 'create', creer: 'create',
  erstelle: 'create', crie: 'create', criar: 'create',
  variavel: 'variable',
  lista: 'list', liste: 'list',
  hola: 'hello', bonjour: 'hello', hallo: 'hello', ola: 'hello',
  mundo: 'world', monde: 'world', welt: 'world',
  suma: 'sum', sumar: 'sum', somme: 'sum', summe: 'sum', soma: 'sum', somar: 'sum',
  cuenta: 'count', contar: 'count', compte: 'count', compter: 'count',
  zahle: 'count', conte: 'count',
  funcion: 'function', fonction: 'function', funktion: 'function', funcao: 'function',
  nombre: 'name', nom: 'name', nome: 'name',
  pide: 'ask', pregunta: 'ask', demande: 'ask', frage: 'ask', peca: 'ask', solicita: 'ask',
  usuario: 'user', utilisateur: 'user', benutzer: 'user',
  factorielle: 'factorial', fakultat: 'factorial', fatorial: 'factorial',
  tabla: 'table', tabelle: 'table', tabuada: 'table',
  multiplicacion: 'multiplication', multiplikation: 'multiplication',
  saluda: 'greet', salue: 'greet', begrusse: 'greet', cumprimente: 'greet',
  dos: 'two', deux: 'two', zwei: 'two', dois: 'two',
  anade: 'add', agrega: 'add', ajoute: 'add', addiere: 'add', adicione: 'add',
  primeros: 'first', premiers: 'first', ersten: 'first', primeiros: 'first',
  invierte: 'reverse', inverser: 'reverse', umkehren: 'reverse', inverter: 'reverse',
  cadena: 'string', chaine: 'string', zeichenkette: 'string'
};

/** Lowercase, strip accents, then swap known foreign keywords for English. */
export function normalize(text) {
  const t = text.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  return t.replace(/[a-z]+/g, w => WORDMAP[w] ?? w);
}

/** Match a normalized description against the known intents. */
export function matchIntent(orig) {
  const t = normalize(orig);
  const nums = (t.match(/-?\d+/g) ?? []).map(Number);
  const q = orig.match(/"([^"]*)"|'([^']*)'/);
  const qtext = q ? (q[1] !== undefined ? q[1] : q[2]) : null;
  const A = [];
  let m;

  /* FizzBuzz */
  if (/fizz\s*buzz/.test(t)) {
    const n = nums.find(x => x > 1) ?? 100;
    if (!nums.length) A.push('No limit given — used the classic 1 to 100.');
    const pr = s => ({ t: 'print', parts: [{ k: 'str', v: s }] });
    return {
      nodes: [{ t: 'for', v: 'i', from: '1', to: String(n), body: [
        { t: 'if', cond: 'i % 15 == 0', body: [pr('FizzBuzz')],
          elifs: [
            { cond: 'i % 3 == 0', body: [pr('Fizz')] },
            { cond: 'i % 5 == 0', body: [pr('Buzz')] }
          ],
          else: [{ t: 'print', parts: [{ k: 'id', v: 'i' }] }] }
      ] }],
      assumptions: A
    };
  }

  /* Fibonacci */
  if (/fibonacci|fibonnaci/.test(t)) {
    const n = nums.find(x => x > 0) ?? 10;
    if (!nums.length) A.push('No count given — printed the first 10 Fibonacci numbers.');
    return {
      nodes: [
        { t: 'var', name: 'a', e: { k: 'num', v: '0' } },
        { t: 'var', name: 'b', e: { k: 'num', v: '1' } },
        { t: 'for', v: 'i', from: '1', to: String(n), body: [
          { t: 'print', parts: [{ k: 'id', v: 'a' }] },
          { t: 'var', name: 'next', e: { k: 'raw', v: 'a + b' } },
          { t: 'assign', name: 'a', e: { k: 'id', v: 'b' } },
          { t: 'assign', name: 'b', e: { k: 'id', v: 'next' } }
        ] }
      ],
      assumptions: A
    };
  }

  /* Factorial */
  if (/factorial/.test(t)) {
    const n = nums.find(x => x >= 0 && x <= 20);
    const val = n !== undefined ? n : 5;
    if (n === undefined) A.push('No number given (or it was above 20) — used 5.');
    return {
      nodes: [
        { t: 'var', name: 'n', e: { k: 'num', v: String(val) } },
        { t: 'var', name: 'result', e: { k: 'num', v: '1' } },
        { t: 'for', v: 'i', from: '2', to: 'n', body: [
          { t: 'assign', name: 'result', e: { k: 'raw', v: 'result * i' } }
        ] },
        { t: 'print', parts: [
          { k: 'id', v: 'n' }, { k: 'str', v: '! = ' }, { k: 'id', v: 'result' }
        ] }
      ],
      assumptions: A
    };
  }

  /* "a function that adds two numbers" */
  if (/\b(function|method)\b/.test(t) && /\b(adds?|sums?|plus)\b/.test(t)) {
    return {
      nodes: [{ t: 'print', parts: [{ k: 'raw', v: 'add(3, 4)' }] }],
      pre: {
        python:     ['def add(a, b):', IND + 'return a + b'],
        javascript: ['function add(a, b) {', IND + 'return a + b;', '}'],
        typescript: ['function add(a: number, b: number): number {', IND + 'return a + b;', '}'],
        java:       ['static int add(int a, int b) {', IND + 'return a + b;', '}'],
        cpp:        ['int add(int a, int b) {', IND + 'return a + b;', '}'],
        csharp:     ['static int add(int a, int b) {', IND + 'return a + b;', '}'],
        go:         ['func add(a int, b int) int {', IND + 'return a + b', '}'],
        rust:       ['fn add(a: i32, b: i32) -> i32 {', IND + 'a + b', '}']
      },
      assumptions: ['Assumed integer inputs; called the function with 3 and 4 as a demo.'],
      explain: [
        'Defines a function `add` that takes two numbers and returns their sum.',
        'Calls `add(3, 4)` and prints the result (7).'
      ]
    };
  }

  /* Ask for a name, then greet */
  if (/\bname\b/.test(t) && /\b(ask|get|read|input|user|greet|hello|say)\b/.test(t)) {
    return {
      nodes: [
        { t: 'input', name: 'name', prompt: 'What is your name? ' },
        { t: 'print', parts: [
          { k: 'str', v: 'Hello, ' }, { k: 'id', v: 'name' }, { k: 'str', v: '!' }
        ] }
      ],
      assumptions: ['Greeting format assumed to be "Hello, <name>!".']
    };
  }

  /* Times table */
  if (/\b(times|multiplication)\s+table\b/.test(t) || /\btable of \d+/.test(t)) {
    const n = nums.find(x => x !== 0) ?? 5;
    if (!nums.length) A.push('No number given — used the 5 times table.');
    A.push('Showed rows 1 through 10.');
    return {
      nodes: [{ t: 'for', v: 'i', from: '1', to: '10', body: [
        { t: 'print', parts: [
          { k: 'raw', v: String(n) }, { k: 'str', v: ' x ' }, { k: 'id', v: 'i' },
          { k: 'str', v: ' = ' }, { k: 'raw', v: n + ' * i' }
        ] }
      ] }],
      assumptions: A
    };
  }

  /* Countdown */
  if (/\bcount\s*down\b|\bcountdown\b|\bbackwards?\b|\bdescending\b|\breverse order\b/.test(t)
      && nums.length) {
    const hi = Math.max(...nums);
    const lo = nums.length > 1 ? Math.min(...nums) : 1;
    if (nums.length < 2) A.push('Assumed the countdown ends at 1.');
    return {
      nodes: [
        { t: 'var', name: 'i', e: { k: 'num', v: String(hi) } },
        { t: 'while', cond: 'i >= ' + lo, body: [
          { t: 'print', parts: [{ k: 'id', v: 'i' }] },
          { t: 'assign', name: 'i', e: { k: 'raw', v: 'i - 1' } }
        ] }
      ],
      assumptions: A
    };
  }

  /* Sum over a range */
  if (/\b(sum|total)\b/.test(t) && nums.length) {
    let a = 1, b;
    if (nums.length >= 2) { a = nums[0]; b = nums[1]; }
    else { b = nums[0]; A.push('Assumed the sum starts at 1.'); }
    return {
      nodes: [
        { t: 'var', name: 'total', e: { k: 'num', v: '0' } },
        { t: 'for', v: 'i', from: String(a), to: String(b), body: [
          { t: 'assign', name: 'total', e: { k: 'raw', v: 'total + i' } }
        ] },
        { t: 'print', parts: [
          { k: 'str', v: 'Sum from ' + a + ' to ' + b + ': ' }, { k: 'id', v: 'total' }
        ] }
      ],
      assumptions: A
    };
  }

  /* Range printing, with an optional even/odd filter */
  const even = /\beven\b/.test(t);
  const odd = /\bodd\b/.test(t);
  let from = null, to = null;
  if ((m = t.match(/from\s+(-?\d+)\s+(?:to|until|through)\s+(-?\d+)/)) ||
      (m = t.match(/(-?\d+)\s*(?:to|through|until|and)\s*(-?\d+)/))) {
    from = +m[1]; to = +m[2];
  } else if ((m = t.match(/\b(?:up to|to|until)\s+(-?\d+)/))) {
    from = 1; to = +m[1];
    A.push('Assumed the count starts at 1.');
  } else if ((m = t.match(/first\s+(\d+)/))) {
    from = 1; to = +m[1];
  }
  if ((even || odd) && from === null) {
    from = 1; to = 100;
    A.push('No range given — defaulted to 1 through 100.');
  }
  if (from !== null && /\b(count|print|show|list|display|number|numbers|even|odd)\b/.test(t)) {
    const printNode = { t: 'print', parts: [{ k: 'id', v: 'i' }] };
    const body = (even || odd)
      ? [{ t: 'if', cond: even ? 'i % 2 == 0' : 'i % 2 != 0', body: [printNode] }]
      : [printNode];
    if (even) A.push('Kept only even numbers.');
    if (odd) A.push('Kept only odd numbers.');
    A.push('Printed one number per line.');
    return {
      nodes: [{ t: 'for', v: 'i', from: String(from), to: String(to), body }],
      assumptions: A
    };
  }

  /* Variable creation */
  if (/\bvariable\b/.test(t)) {
    let name = 'x';
    const reserved = ['with', 'that', 'of', 'to', 'and', 'equal', 'value', 'called', 'named', 'set'];
    if ((m = t.match(/variable\s+(?:called\s+|named\s+)?([a-z_]\w*)/)) && !reserved.includes(m[1])) {
      name = m[1];
    } else {
      A.push('No variable name given — used `x`.');
    }
    let e;
    if (qtext !== null) e = { k: 'str', v: qtext };
    else if (nums.length) e = { k: 'num', v: String(nums[nums.length - 1]) };
    else { e = { k: 'num', v: '0' }; A.push('No value given — used 0.'); }
    return {
      nodes: [
        { t: 'var', name, e },
        { t: 'print', parts: [{ k: 'str', v: name + ' = ' }, { k: 'id', v: name }] }
      ],
      assumptions: A
    };
  }

  /* Literal output */
  if (/hello,?\s+world/.test(t)) {
    return { nodes: [{ t: 'print', parts: [{ k: 'str', v: 'Hello, World!' }] }], assumptions: A };
  }
  if (qtext !== null && /\b(print|say|show|display|write|output|echo)\b/.test(t)) {
    return { nodes: [{ t: 'print', parts: [{ k: 'str', v: qtext }] }], assumptions: A };
  }
  if ((m = t.match(/^\s*(?:please\s+)?(?:print|say|show|display|write|output|echo)\s+(.+?)\s*$/))) {
    A.push('Treated the text after the verb as a literal string.');
    return {
      nodes: [{ t: 'print', parts: [{ k: 'str', v: m[1].replace(/^["']|["']$/g, '') }] }],
      assumptions: A
    };
  }

  return null;
}

export const NL_UNMATCHED =
  'The offline rule engine could not match that description. It understands phrases like ' +
  '"print the numbers from 1 to 100", "sum 1 to 50", "fizzbuzz", "factorial of 6", ' +
  '"count down from 10", "ask the user for their name", "5 times table", or ' +
  '"create a variable score with value 10" (also in Spanish, French, German, or Portuguese). ' +
  'For anything else, switch to Claude AI mode.';

/** Translate a plain-language description into `target` source code. */
export function ruleFromDescription(text, target) {
  const intent = matchIntent(text);
  if (!intent) return { error: NL_UNMATCHED };
  return {
    code: buildProgram(intent.nodes, target, intent.pre),
    lang: target,
    assumptions: intent.assumptions ?? [],
    explanation: intent.explain ?? explainNodes(intent.nodes)
  };
}
