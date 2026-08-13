/* Minimal tokenizer for display only — strings and comments first, then
   keywords and numbers in whatever is left.                               */

const KEYWORDS = {
  python:     'def return if elif else for while in and or not True False None import from break continue pass print input range len',
  javascript: 'function return if else for while let const var of in new true false null undefined break continue',
  typescript: 'function return if else for while let const var of in new true false null undefined break continue string number boolean',
  java:       'public static void class import int double String var new if else for while return true false null',
  cpp:        'include using namespace std int double auto string if else for while return',
  csharp:     'using class static void var int double string if else for while return true false null',
  go:         'package import func var if else for return string int range nil true false',
  rust:       'fn let mut if else for while in return use String i32 true false'
};

export function escapeHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function highlight(code, langId) {
  const kws = (KEYWORDS[langId] ?? '').split(/\s+/).filter(Boolean);
  const kwRe = kws.length ? new RegExp('\\b(' + kws.join('|') + ')\\b', 'g') : null;
  const commentSrc = langId === 'python' ? '#[^\\n]*' : '\\/\\/[^\\n]*|\\/\\*[\\s\\S]*?\\*\\/';
  const tokenRe = new RegExp(
    '("(?:\\\\.|[^"\\\\])*"|\'(?:\\\\.|[^\'\\\\])*\'|`(?:\\\\.|[^`\\\\])*`|' + commentSrc + ')', 'g');

  const plain = s => {
    let t = escapeHtml(s);
    if (kwRe) t = t.replace(kwRe, '<span class="tk-kw">$1</span>');
    return t.replace(/\b(\d+(?:\.\d+)?)\b/g, '<span class="tk-num">$1</span>');
  };

  let out = '', last = 0, m;
  while ((m = tokenRe.exec(code))) {
    out += plain(code.slice(last, m.index));
    const tok = m[0];
    const cls = (tok[0] === '"' || tok[0] === "'" || tok[0] === '`') ? 'str' : 'com';
    out += '<span class="tk-' + cls + '">' + escapeHtml(tok) + '</span>';
    last = m.index + tok.length;
  }
  return out + plain(code.slice(last));
}
