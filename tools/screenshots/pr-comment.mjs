// Writes the text of the pull request comment with «before / after / difference» pictures of the pages that changed.
//   node tools/screenshots/pr-comment.mjs <owner/repo> <baseline commit> <new commit> <changed.json> <output .md>
// The pictures are read from the branches of the screenshots job through raw.githubusercontent.com by commit, so they stay as they were.
import fs from 'node:fs';

const [repo, baseSha, newSha, changedFile, out] = process.argv.slice(2);
const raw = (sha, f) => `https://raw.githubusercontent.com/${repo}/${sha}/${f}`;
const MAX = 8;
let list = [];
try { list = JSON.parse(fs.readFileSync(changedFile, 'utf8')); } catch { /* no comparison was made */ }
// the first screen of a page (-top) is the readable one; the full-page pictures are only listed
const tops = list.filter((x) => x.file.endsWith('-top.png')).sort((a, b) => b.pct - a.pct);
const shown = tops.slice(0, MAX);
const lines = ['<!-- screenshots-diff -->', '### Screenshots: what changed against main', ''];
if (!list.length) lines.push('No visual changes on the demo pages.');
else {
  lines.push(`${list.length} picture(s) differ (${tops.length} first screens). Largest changes first.`, '');
  for (const x of shown) {
    const same = x.note.startsWith('size');
    lines.push(`<details><summary><b>${x.file.replace(/-top\.png$/, '')}</b>: ${x.note}</summary>`, '',
      `| before (main) | after | difference |`, `|---|---|---|`,
      `| <img src="${raw(baseSha, x.file)}" width="260"> | <img src="${raw(newSha, x.file)}" width="260"> | ${same ? '' : `<img src="${raw(newSha, 'diff/' + x.file)}" width="260">`} |`, '', '</details>', '');
  }
  const rest = list.filter((x) => !shown.includes(x));
  if (rest.length) lines.push(`Also changed: ${rest.slice(0, 30).map((x) => '`' + x.file + '`').join(', ')}${rest.length > 30 ? ' …' : ''}`, '');
}
lines.push(`<sub>Commit ${newSha.slice(0, 7)} against main ${baseSha.slice(0, 7)}. Full set: DIFF.md, A11Y.md and OVERFLOW.md in the same branch.</sub>`);
fs.writeFileSync(out, lines.join('\n') + '\n');
