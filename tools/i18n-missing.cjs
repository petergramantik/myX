// Vytáhne české texty ze zdrojů: řetězce, šablony (→ vzory s {0}), JSX text. Výstup JSON {exact:[], patterns:[]}.
// Vypíše české texty z kódu, které chybí v anglickém slovníku (src/i18n/en.ts). Spuštění: node tools/i18n-missing.cjs
// (potřebuje balík typescript – cestu uprav v TS_PATH nebo nastav proměnnou TS_PATH).
const ts = require(process.env.TS_PATH || '/opt/npm-tools/node_modules/typescript');
const fs = require('fs'), path = require('path');
const root = process.argv[2] || path.join(__dirname, '..');
const files = [];
for (const d of ['src', 'src/ui', 'src/app', 'src/core']) for (const f of fs.readdirSync(path.join(root, d))) if (/\.tsx?$/.test(f)) files.push(path.join(root, d, f));
const CZ = /[áčďéěíňóřšťúůýžÁČĎÉĚÍŇÓŘŠŤÚŮÝŽ]|\b(je|jen|na|do|od|pro|bez|nebo|lahev|ponor|tlak|bar|min|zadej|není|uložit|zrušit|smazat|ano|ne)\b/i;
const exact = new Map(), patterns = new Map();
const UI = (s) => CZ.test(s) || /^[A-ZÁČĎÉĚÍŇÓŘŠŤÚŮÝŽ][a-záčďéěíňóřšťúůýž]+([ .,:–-]|$)/.test(s) || (/ /.test(s) && /[a-z]{3}/.test(s) && !/[{};=<>]|^[a-z-]+( [a-z-]+)*$/.test(s));
const add = (m, s, f, jsx) => { s = s.replace(/\s+/g, ' ').trim(); if (s.length < 2 || !/[A-Za-zÁ-ž]{2}/.test(s)) return; if (!jsx && !UI(s.replace(/\{\d+\}/g, 'X'))) return; if (/^(https?:|\/|#|\.|data:)/.test(s)) return; if (!m.has(s)) m.set(s, f); };
for (const f of files) {
  if (/Help(En)?\.tsx$/.test(f) || /version\.ts$/.test(f)) continue;
  const src = ts.createSourceFile(f, fs.readFileSync(f, 'utf8'), ts.ScriptTarget.Latest, true, f.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const rel = path.relative(root, f);
  const walk = (n) => {
    if (ts.isImportDeclaration(n)) return;
    if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) add(exact, n.text, rel);
    else if (ts.isTemplateExpression(n)) {
      let s = n.head.text; n.templateSpans.forEach((sp, i) => { s += `{${i}}` + sp.literal.text; });
      add(patterns, s, rel);
    } else if (ts.isJsxText(n)) add(exact, n.text, rel, true);
    ts.forEachChild(n, walk);
  };
  walk(src);
}
const en = fs.readFileSync(path.join(root, 'src/i18n/en.ts'), 'utf8');
const has = (k) => en.includes(JSON.stringify(k) + ':');
const miss = [...[...exact.entries()].filter(([k]) => !has(k)).map(([k, f]) => `E\t${k}\t${f}`), ...[...patterns.entries()].filter(([k]) => !has(k)).map(([k, f]) => `P\t${k}\t${f}`)];
console.log(miss.join('\n'));
console.error(`${exact.size} textů, ${patterns.size} vzorů, chybí ${miss.length}`);
