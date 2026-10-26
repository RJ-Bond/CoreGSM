#!/usr/bin/env node
// Prints the text of a GitHub Release from CHANGELOG.md: the section "## <version> ..." in Russian, then in English.
// Usage: node tools/release-notes.mjs <version> [CHANGELOG.md]
// Lines are "ru | en" (emoji in front of the Russian part is repeated for the English one). Prints nothing when the
// section is missing or empty, so the release workflow can stop.
import { readFileSync } from 'node:fs';

const [version, file = 'CHANGELOG.md'] = process.argv.slice(2);
if (!version) { console.error('usage: release-notes.mjs <version> [file]'); process.exit(2); }

const EMOJI = /^(\p{Extended_Pictographic}[️‍\p{Extended_Pictographic}]*)\s+/u;
function split(text) {
  const i = text.indexOf(' | ');
  if (i < 0) return { ru: text.trim(), en: text.trim() };
  const ru = text.slice(0, i).trim();
  let en = text.slice(i + 3).trim();
  const e = EMOJI.exec(ru);
  if (e && en && !/^\p{Extended_Pictographic}/u.test(en)) en = `${e[1]} ${en}`;
  return { ru, en: en || ru };
}

const lines = readFileSync(file, 'utf8').replace(/\r/g, '').split('\n');
const head = new RegExp(`^##\\s+${version.replace(/\./g, '\\.')}(?![\\d.])`);
let inSection = false;
const ru = [];
const en = [];
for (const raw of lines) {
  const line = raw.trimEnd();
  if (/^##\s/.test(line) && !line.startsWith('###')) { inSection = head.test(line); continue; }
  if (!inSection) continue;
  const h3 = /^###\s+(.+)$/.exec(line);
  if (h3) { const s = split(h3[1]); ru.push('', `### ${s.ru}`); en.push('', `### ${s.en}`); continue; }
  const li = /^[-*]\s+(.+)$/.exec(line);
  if (li) { const s = split(li[1]); ru.push(`- ${s.ru}`); en.push(`- ${s.en}`); }
}
if (!ru.some((l) => l.startsWith('- '))) process.exit(0);
console.log(`## 🇷🇺 Русский${ru.join('\n')}\n\n---\n\n## 🇬🇧 English${en.join('\n')}`);
