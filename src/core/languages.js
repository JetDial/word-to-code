/* Target-language emitters.
   Every emitter consumes the same language-neutral statement tree produced by
   the natural-language engine and the code parser:
   print / var / assign / for / while / if / input / comment / unknown        */

export const IND = '    ';

export function indent(lines, n) {
  return lines.map(l => (l === '' ? '' : IND.repeat(n) + l));
}

/** Render an expression node as target-language source text. */
export function ex(e) {
  return e.k === 'str' ? JSON.stringify(e.v) : String(e.v);
}

export function plusOne(v) {
  const n = Number(v);
  return Number.isFinite(n) ? String(n + 1) : v + ' + 1';
}

export function minusOne(v) {
  const n = Number(v);
  return Number.isFinite(n) ? String(n - 1) : v + ' - 1';
}

/** Normalize a condition written in one family's syntax for the target family. */
export function fixCond(c, style) {
  c = String(c).trim().replace(/===/g, '==').replace(/!==/g, '!=');
  if (style === 'py') {
    return c
      .replace(/&&/g, ' and ')
      .replace(/\|\|/g, ' or ')
      .replace(/!(?!=)/g, 'not ')
      .replace(/\btrue\b/g, 'True')
      .replace(/\bfalse\b/g, 'False')
      .replace(/\s+/g, ' ')
      .trim();
  }
  return c
    .replace(/\band\b/g, '&&')
    .replace(/\bor\b/g, '||')
    .replace(/\bnot\s+/g, '!')
    .replace(/\bTrue\b/g, 'true')
    .replace(/\bFalse\b/g, 'false');
}

export const LANGS = {
  python: {
    id: 'python', label: 'Python', ext: 'py', style: 'py', comment: '#',
    print(parts) {
      if (parts.length === 1) return 'print(' + ex(parts[0]) + ')';
      return 'print(f"' + parts.map(p => p.k === 'str'
        ? p.v.replace(/{/g, '{{').replace(/}/g, '}}')
        : '{' + p.v + '}').join('') + '")';
    },
    varDecl(n, e) { return n + ' = ' + ex(e); },
    assign(n, e) { return n + ' = ' + ex(e); },
    forHead(v, f, t) { return 'for ' + v + ' in range(' + f + ', ' + plusOne(t) + ')'; },
    whileHead(c) { return 'while ' + c; },
    input(n, p) { return [n + ' = input(' + JSON.stringify(p) + ')']; },
    wrap(pre, body) { return [...pre, ...(pre.length ? [''] : []), ...body]; }
  },

  javascript: {
    id: 'javascript', label: 'JavaScript', ext: 'js', style: 'c', parens: true, comment: '//',
    print(parts) {
      if (parts.length === 1) return 'console.log(' + ex(parts[0]) + ');';
      return 'console.log(`' + parts.map(p => p.k === 'str' ? p.v : '${' + p.v + '}').join('') + '`);';
    },
    varDecl(n, e) { return 'let ' + n + ' = ' + ex(e) + ';'; },
    assign(n, e) { return n + ' = ' + ex(e) + ';'; },
    forHead(v, f, t) { return 'for (let ' + v + ' = ' + f + '; ' + v + ' <= ' + t + '; ' + v + '++)'; },
    whileHead(c) { return 'while (' + c + ')'; },
    input(n, p) { return ['const ' + n + ' = prompt(' + JSON.stringify(p.trim()) + ');']; },
    wrap(pre, body) { return [...pre, ...(pre.length ? [''] : []), ...body]; }
  },

  typescript: {
    id: 'typescript', label: 'TypeScript', ext: 'ts', style: 'c', parens: true, comment: '//',
    print(parts) {
      if (parts.length === 1) return 'console.log(' + ex(parts[0]) + ');';
      return 'console.log(`' + parts.map(p => p.k === 'str' ? p.v : '${' + p.v + '}').join('') + '`);';
    },
    varDecl(n, e) {
      const ty = e.k === 'str' ? ': string' : e.k === 'num' ? ': number' : '';
      return 'let ' + n + ty + ' = ' + ex(e) + ';';
    },
    assign(n, e) { return n + ' = ' + ex(e) + ';'; },
    forHead(v, f, t) { return 'for (let ' + v + ': number = ' + f + '; ' + v + ' <= ' + t + '; ' + v + '++)'; },
    whileHead(c) { return 'while (' + c + ')'; },
    input(n, p) { return ['const ' + n + ': string = prompt(' + JSON.stringify(p.trim()) + ') ?? "";']; },
    wrap(pre, body) { return [...pre, ...(pre.length ? [''] : []), ...body]; }
  },

  java: {
    id: 'java', label: 'Java', ext: 'java', style: 'c', parens: true, comment: '//',
    print(parts) {
      if (parts.length === 1) return 'System.out.println(' + ex(parts[0]) + ');';
      let items = parts.map(ex);
      if (parts[0].k !== 'str') items = ['""', ...items];
      return 'System.out.println(' + items.join(' + ') + ');';
    },
    varDecl(n, e) {
      const ty = e.k === 'str' ? 'String'
        : e.k === 'num' ? (String(e.v).includes('.') ? 'double' : 'int')
        : 'var';
      return ty + ' ' + n + ' = ' + ex(e) + ';';
    },
    assign(n, e) { return n + ' = ' + ex(e) + ';'; },
    forHead(v, f, t) { return 'for (int ' + v + ' = ' + f + '; ' + v + ' <= ' + t + '; ' + v + '++)'; },
    whileHead(c) { return 'while (' + c + ')'; },
    input(n, p) {
      return ['System.out.print(' + JSON.stringify(p) + ');',
              'String ' + n + ' = new Scanner(System.in).nextLine();'];
    },
    wrap(pre, body, needs) {
      const out = [];
      if (needs.input) out.push('import java.util.Scanner;', '');
      out.push('public class Main {');
      if (pre.length) out.push(...indent(pre, 1), '');
      out.push(IND + 'public static void main(String[] args) {');
      out.push(...indent(body, 2));
      out.push(IND + '}', '}');
      return out;
    }
  },

  cpp: {
    id: 'cpp', label: 'C++', ext: 'cpp', style: 'c', parens: true, comment: '//',
    print(parts) { return 'cout << ' + parts.map(ex).join(' << ') + ' << "\\n";'; },
    varDecl(n, e) {
      const ty = e.k === 'str' ? 'string'
        : e.k === 'num' ? (String(e.v).includes('.') ? 'double' : 'int')
        : 'auto';
      return ty + ' ' + n + ' = ' + ex(e) + ';';
    },
    assign(n, e) { return n + ' = ' + ex(e) + ';'; },
    forHead(v, f, t) { return 'for (int ' + v + ' = ' + f + '; ' + v + ' <= ' + t + '; ' + v + '++)'; },
    whileHead(c) { return 'while (' + c + ')'; },
    input(n, p) {
      return ['cout << ' + JSON.stringify(p) + ';', 'string ' + n + ';', 'getline(cin, ' + n + ');'];
    },
    wrap(pre, body) {
      const out = ['#include <iostream>', '#include <string>', 'using namespace std;', ''];
      if (pre.length) out.push(...pre, '');
      out.push('int main() {', ...indent(body, 1), IND + 'return 0;', '}');
      return out;
    }
  },

  csharp: {
    id: 'csharp', label: 'C#', ext: 'cs', style: 'c', parens: true, comment: '//',
    print(parts) {
      if (parts.length === 1) return 'Console.WriteLine(' + ex(parts[0]) + ');';
      return 'Console.WriteLine($"' + parts.map(p => p.k === 'str' ? p.v : '{' + p.v + '}').join('') + '");';
    },
    varDecl(n, e) { return 'var ' + n + ' = ' + ex(e) + ';'; },
    assign(n, e) { return n + ' = ' + ex(e) + ';'; },
    forHead(v, f, t) { return 'for (int ' + v + ' = ' + f + '; ' + v + ' <= ' + t + '; ' + v + '++)'; },
    whileHead(c) { return 'while (' + c + ')'; },
    input(n, p) {
      return ['Console.Write(' + JSON.stringify(p) + ');', 'string ' + n + ' = Console.ReadLine();'];
    },
    wrap(pre, body) {
      const out = ['using System;', '', 'class Program {'];
      if (pre.length) out.push(...indent(pre, 1), '');
      out.push(IND + 'static void Main() {');
      out.push(...indent(body, 2));
      out.push(IND + '}', '}');
      return out;
    }
  },

  go: {
    id: 'go', label: 'Go', ext: 'go', style: 'c', parens: false, comment: '//',
    print(parts) {
      if (parts.length === 1) return 'fmt.Println(' + ex(parts[0]) + ')';
      const f = parts.map(p => p.k === 'str' ? p.v.replace(/%/g, '%%') : '%v').join('');
      const args = parts.filter(p => p.k !== 'str').map(ex);
      return 'fmt.Printf("' + f + '\\n", ' + args.join(', ') + ')';
    },
    varDecl(n, e) { return n + ' := ' + ex(e); },
    assign(n, e) { return n + ' = ' + ex(e); },
    forHead(v, f, t) { return 'for ' + v + ' := ' + f + '; ' + v + ' <= ' + t + '; ' + v + '++'; },
    whileHead(c) { return 'for ' + c; },
    input(n, p) {
      return ['fmt.Print(' + JSON.stringify(p) + ')', 'var ' + n + ' string', 'fmt.Scanln(&' + n + ')'];
    },
    wrap(pre, body) {
      const out = ['package main', '', 'import "fmt"', ''];
      if (pre.length) out.push(...pre, '');
      out.push('func main() {', ...indent(body, 1), '}');
      return out;
    }
  },

  rust: {
    id: 'rust', label: 'Rust', ext: 'rs', style: 'c', parens: false, comment: '//',
    print(parts) {
      if (parts.length === 1) {
        const p = parts[0];
        if (p.k === 'str') return 'println!(' + JSON.stringify(p.v) + ');';
        return 'println!("{}", ' + ex(p) + ');';
      }
      const f = parts.map(p => p.k === 'str'
        ? p.v.replace(/{/g, '{{').replace(/}/g, '}}') : '{}').join('');
      const args = parts.filter(p => p.k !== 'str').map(ex);
      return 'println!("' + f + '", ' + args.join(', ') + ');';
    },
    varDecl(n, e) { return 'let mut ' + n + ' = ' + ex(e) + ';'; },
    assign(n, e) { return n + ' = ' + ex(e) + ';'; },
    forHead(v, f, t) { return 'for ' + v + ' in ' + f + '..=' + t; },
    whileHead(c) { return 'while ' + c; },
    input(n, p) {
      return ['println!(' + JSON.stringify(p.trim()) + ');',
              'let mut ' + n + ' = String::new();',
              'std::io::stdin().read_line(&mut ' + n + ').unwrap();',
              'let ' + n + ' = ' + n + '.trim();'];
    },
    wrap(pre, body) {
      return [...pre, ...(pre.length ? [''] : []), 'fn main() {', ...indent(body, 1), '}'];
    }
  }
};
