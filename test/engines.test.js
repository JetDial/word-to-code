import test from 'node:test';
import assert from 'node:assert/strict';

import { LANGS } from '../src/core/languages.js';
import { ruleFromDescription, normalize, matchIntent } from '../src/core/nl.js';
import { ruleFromCode, parseVal, splitTop } from '../src/core/codeparse.js';
import { buildRequest, parseAiText, readEnvelope, aiTranslate } from '../src/core/ai.js';
import { highlight, escapeHtml } from '../src/core/highlight.js';

const TARGETS = Object.keys(LANGS);

/* ------------------------------------------------------- helpers/normalize */

test('normalize maps foreign keywords to English and strips accents', () => {
  assert.match(normalize('imprime los números pares'), /print/);
  assert.match(normalize('imprime los números pares'), /even/);
  assert.match(normalize('la factorielle de 8'), /factorial/);
  assert.match(normalize('zähle von 1 bis 20'), /count/);
  assert.ok(!/[áéíóúñüö]/.test(normalize('números año führen')));
});

test('splitTop respects nesting and quotes', () => {
  assert.deepEqual(splitTop('a, b'), ['a', 'b']);
  assert.deepEqual(splitTop('f(1, 2), b'), ['f(1, 2)', 'b']);
  assert.deepEqual(splitTop('"x, y", z'), ['"x, y"', 'z']);
});

test('parseVal classifies literals', () => {
  assert.deepEqual(parseVal('42'), { k: 'num', v: '42' });
  assert.deepEqual(parseVal('"hi"'), { k: 'str', v: 'hi' });
  assert.deepEqual(parseVal('a + b'), { k: 'raw', v: 'a + b' });
});

/* -------------------------------------------------- natural language mode */

test('every intent compiles in every target language', () => {
  const prompts = [
    'print the numbers from 1 to 100 and only the even ones',
    'sum the numbers from 1 to 50',
    'fizzbuzz up to 30',
    'print the first 12 fibonacci numbers',
    'factorial of 6',
    'ask the user for their name and greet them',
    'make a function that adds two numbers',
    '7 times table',
    'count down from 10',
    'create a variable score with value 10',
    'hello world'
  ];
  for (const p of prompts) {
    for (const target of TARGETS) {
      const r = ruleFromDescription(p, target);
      assert.ok(!r.error, `"${p}" -> ${target} errored: ${r.error}`);
      assert.ok(r.code.trim().length > 0, `"${p}" -> ${target} produced no code`);
      assert.equal(r.lang, target);
      assert.ok(Array.isArray(r.explanation) && r.explanation.length > 0,
        `"${p}" -> ${target} produced no explanation`);
    }
  }
});

test('range + even filter produces the right bounds and guard', () => {
  const py = ruleFromDescription('print numbers 1 to 100, only even ones', 'python').code;
  assert.match(py, /for i in range\(1, 101\):/);
  assert.match(py, /if i % 2 == 0:/);

  const go = ruleFromDescription('print numbers 1 to 100, only even ones', 'go').code;
  assert.match(go, /for i := 1; i <= 100; i\+\+/);
  assert.match(go, /package main/);
});

test('non-English descriptions work', () => {
  const es = ruleFromDescription('imprime los números pares del 1 al 50', 'python');
  assert.ok(!es.error);
  assert.match(es.code, /range\(1, 51\)/);

  const fr = ruleFromDescription('la factorielle de 8', 'python');
  assert.ok(!fr.error);
  assert.match(fr.code, /n = 8/);

  const de = ruleFromDescription('zähle von 1 bis 20', 'javascript');
  assert.ok(!de.error);
  assert.match(de.code, /i <= 20/);
});

test('language wrappers include required boilerplate', () => {
  const java = ruleFromDescription('ask the user for their name and greet them', 'java').code;
  assert.match(java, /import java\.util\.Scanner;/);
  assert.match(java, /public class Main \{/);

  const cpp = ruleFromDescription('hello world', 'cpp').code;
  assert.match(cpp, /#include <iostream>/);
  assert.match(cpp, /int main\(\)/);

  const rust = ruleFromDescription('hello world', 'rust').code;
  assert.match(rust, /fn main\(\)/);
  assert.match(rust, /println!\("Hello, World!"\);/);
});

test('unmatched descriptions return a helpful error, not code', () => {
  const r = ruleFromDescription('what is the meaning of life', 'python');
  assert.ok(r.error);
  assert.match(r.error, /could not match/i);
  assert.equal(r.code, undefined);
});

test('assumptions are reported when the engine fills in a blank', () => {
  const r = ruleFromDescription('print the even numbers', 'python');
  assert.ok(r.assumptions.some(a => /defaulted to 1 through 100/i.test(a)));
});

/* ---------------------------------------------------------- code -> code */

const PY_SRC = `total = 0
# add up the even numbers
for i in range(1, 11):
    if i % 2 == 0:
        total = total + i
print(f"Sum of evens: {total}")`;

test('python source translates to every target', () => {
  for (const target of TARGETS) {
    if (target === 'python') continue;
    const r = ruleFromCode(PY_SRC, 'python', target);
    assert.ok(!r.error, `python -> ${target}: ${r.error}`);
    assert.match(r.code, /total/);
  }
});

test('python loop bounds convert correctly (exclusive -> inclusive)', () => {
  const js = ruleFromCode(PY_SRC, 'python', 'javascript').code;
  assert.match(js, /for \(let i = 1; i <= 10; i\+\+\)/);
  assert.match(js, /console\.log\(`Sum of evens: \$\{total\}`\)/);

  const rust = ruleFromCode(PY_SRC, 'python', 'rust').code;
  assert.match(rust, /for i in 1\.\.=10/);
});

test('python comments survive translation', () => {
  const go = ruleFromCode(PY_SRC, 'python', 'go').code;
  assert.match(go, /\/\/ add up the even numbers/);
});

test('python if/elif/else maps onto each family', () => {
  const src = `x = 5
if x > 3:
    print("big")
elif x == 3:
    print("three")
else:
    print("small")`;
  const cs = ruleFromCode(src, 'python', 'csharp').code;
  assert.match(cs, /if \(x > 3\) \{/);
  assert.match(cs, /\} else if \(x == 3\) \{/);
  assert.match(cs, /\} else \{/);
});

test('python input becomes idiomatic reads', () => {
  const src = 'name = input("Your name? ")\nprint(f"Hi {name}")';
  assert.match(ruleFromCode(src, 'python', 'go').code, /fmt\.Scanln\(&name\)/);
  assert.match(ruleFromCode(src, 'python', 'csharp').code, /Console\.ReadLine\(\)/);
  assert.match(ruleFromCode(src, 'python', 'java').code, /Scanner/);
});

const JS_SRC = `// count evens
let total = 0;
for (let i = 1; i < 11; i++) {
    if (i % 2 === 0 && i > 2) {
        total += i;
    } else {
        console.log(\`skipping \${i}\`);
    }
}
console.log("total:", total);`;

test('javascript source translates and normalizes operators', () => {
  const py = ruleFromCode(JS_SRC, 'javascript', 'python').code;
  assert.match(py, /for i in range\(1, 11\):/);
  // === must not leak into Python, and && must become `and`
  assert.ok(!py.includes('==='), 'strict equality leaked into Python');
  assert.match(py, /if i % 2 == 0 and i > 2:/);
  assert.match(py, /else:/);

  const cpp = ruleFromCode(JS_SRC, 'javascript', 'cpp').code;
  assert.ok(!cpp.includes('==='), 'strict equality leaked into C++');
  assert.match(cpp, /i % 2 == 0 && i > 2/);
});

test('unsupported source language is refused clearly', () => {
  const r = ruleFromCode('fmt.Println("hi")', 'go', 'python');
  assert.ok(r.error);
  assert.match(r.error, /only read Python or JavaScript/);
});

test('unparseable lines are preserved as comments and counted', () => {
  const r = ruleFromCode('print("ok")\nclass Foo(Bar):', 'python', 'javascript');
  assert.ok(!r.error);
  assert.match(r.code, /\/\/ \[not translated\] class Foo\(Bar\):/);
  assert.ok(r.assumptions.some(a => /could not be understood/.test(a)));
});

test('empty input is refused', () => {
  assert.ok(ruleFromCode('', 'python', 'go').error);
});

/* ------------------------------------------------------------- AI module */

test('buildRequest shapes both modes correctly', () => {
  const nl = buildRequest({ mode: 'nl', text: 'print hi', target: 'rust' });
  assert.equal(nl.model, 'claude-opus-5');
  assert.equal(nl.fallbacks, 'default');
  assert.match(nl.system, /plain-language/);
  assert.match(nl.messages[0].content, /Target language: Rust/);

  const code = buildRequest({ mode: 'code', text: 'x=1', source: 'python', target: 'go' });
  assert.match(code.system, /one programming language to another/);
  assert.match(code.messages[0].content, /Source language: Python/);
  assert.match(code.messages[0].content, /Target language: Go/);
});

test('parseAiText extracts code, assumptions and explanation', () => {
  const reply = [
    'ASSUMPTIONS: Assumed 1-based counting.',
    '```python',
    'print("hi")',
    '```',
    'EXPLANATION:',
    '- Prints hi',
    '- Nothing else'
  ].join('\n');
  const r = parseAiText(reply, 'python');
  assert.equal(r.code, 'print("hi")');
  assert.deepEqual(r.assumptions, ['Assumed 1-based counting.']);
  assert.deepEqual(r.explanation, ['Prints hi', 'Nothing else']);
});

test('parseAiText treats "none" assumptions as empty', () => {
  const r = parseAiText('ASSUMPTIONS: none\n```go\nx := 1\n```\nEXPLANATION:\n- sets x', 'go');
  assert.deepEqual(r.assumptions, []);
});

test('parseAiText surfaces NOT_CODE as a friendly error', () => {
  const r = parseAiText('NOT_CODE: that is a philosophical question', 'python');
  assert.ok(r.error);
  assert.match(r.error, /philosophical/);
  assert.equal(r.code, undefined);
});

test('readEnvelope handles refusal and truncation', () => {
  assert.match(readEnvelope({ stop_reason: 'refusal', content: [] }, 'python').error, /declined/);
  assert.match(
    readEnvelope({ stop_reason: 'max_tokens', content: [{ type: 'text', text: 'partial' }] }, 'python').error,
    /cut off/
  );
});

test('aiTranslate maps transport failures to readable errors', async () => {
  const r401 = await aiTranslate({ mode: 'nl', text: 'x', target: 'python' },
    async () => ({ ok: false, status: 401, error: 'invalid x-api-key' }));
  assert.match(r401.error, /invalid x-api-key/);
  assert.match(r401.error, /API key is valid/);

  const r429 = await aiTranslate({ mode: 'nl', text: 'x', target: 'python' },
    async () => ({ ok: false, status: 429, error: 'rate limit' }));
  assert.match(r429.error, /rate limited/);
});

test('aiTranslate returns parsed code on success', async () => {
  const r = await aiTranslate({ mode: 'nl', text: 'say hi', target: 'python' }, async () => ({
    ok: true,
    data: {
      stop_reason: 'end_turn',
      content: [{ type: 'text', text: 'ASSUMPTIONS: none\n```python\nprint("hi")\n```\nEXPLANATION:\n- prints' }]
    }
  }));
  assert.equal(r.code, 'print("hi")');
  assert.equal(r.lang, 'python');
});

/* ----------------------------------------------------------- highlighting */

test('highlight escapes HTML and tags tokens', () => {
  const out = highlight('if x < 3: print("a")', 'python');
  assert.ok(out.includes('&lt;'), 'did not escape <');
  assert.ok(out.includes('tk-kw'), 'no keyword span');
  assert.ok(out.includes('tk-str'), 'no string span');
  assert.ok(out.includes('tk-num'), 'no number span');
});

test('highlight never emits raw angle brackets from input', () => {
  const evil = 'x = "<img src=x onerror=alert(1)>"';
  const out = highlight(evil, 'python');
  assert.ok(!out.includes('<img'), 'raw tag survived escaping');
  assert.equal(escapeHtml('<&>'), '&lt;&amp;&gt;');
});
