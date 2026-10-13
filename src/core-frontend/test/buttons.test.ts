import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The button system lives in src/styles/buttons.css (plus the dependents kept elsewhere). Every `btn-*` / `row-act*`
 * class used in the sources must have a selector there: a typo would silently render an unstyled button.
 */
const SRC = resolve(__dirname, '../src');

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(tsx|ts)$/.test(name)) out.push(p);
  }
  return out;
}

const css = ['styles/buttons.css', 'index.css', 'styles/detail.css', 'styles/servers.css', 'styles/system.css', 'styles/profile.css']
  .map((f) => readFileSync(join(SRC, f), 'utf8'))
  .join('\n');
const buttonsCss = readFileSync(join(SRC, 'styles/buttons.css'), 'utf8');

/** class tokens such as `btn-soft`; `btn-${x}` template prefixes (trailing dash) are skipped */
const used = new Map<string, string>();
for (const file of walk(SRC)) {
  const text = readFileSync(file, 'utf8');
  for (const m of text.matchAll(/(?<![\w-])((?:btn|row-act)(?:-[a-z]+)*)(?![\w$-])/g)) {
    const token = m[1];
    if (token.endsWith('-')) continue;
    if (!used.has(token)) used.set(token, file);
  }
}

describe('button classes', () => {
  it('scans the sources', () => {
    expect(used.size).toBeGreaterThan(10);
  });

  for (const [token, file] of used) {
    it(`.${token} has a selector (${file.replace(SRC, 'src')})`, () => {
      // JS identifiers and props such as `btn` (a local variable) are fine as long as the class exists too
      const re = new RegExp(`\.${token}(?![\w-])`);
      expect(re.test(css), `no CSS selector for .${token}`).toBe(true);
    });
  }

  it('the system stylesheet defines every documented variant, size, icon and group class', () => {
    const must = [
      'btn', 'btn-soft', 'btn-outline', 'btn-ghost', 'btn-danger', 'btn-danger-solid', 'btn-solid-danger', 'btn-success', 'btn-success-solid', 'btn-warn',
      'btn-link', 'btn-xs', 'btn-sm', 'btn-lg', 'btn-block', 'btn-icon', 'btn-icon-sm', 'btn-icon-ghost', 'btn-icon-danger', 'btn-group',
      'btn-on-grad', 'btn-ghost-on-grad', 'btn-glass', 'btn-glass-quiet', 'btn-glass-danger', 'btn-cta', 'row-act', 'pp-copy', 'split',
    ];
    for (const c of must) expect(new RegExp(`\.${c}(?![\w-])`).test(buttonsCss), c).toBe(true);
  });

  it('no transform, translate or scale transition and no outline styling in the button stylesheet', () => {
    // comments may mention the words; look at declarations only
    const code = buttonsCss.replace(/\/\*[\s\S]*?\*\//g, '');
    expect(/transition[^;{}]*\b(transform|translate|scale|rotate)\b/.test(code.replace(/\.(split|ico)[^{]*\{[^}]*\}/g, ''))).toBe(false);
    expect(/(^|[;{\s])outline(-color)?\s*:/.test(code)).toBe(false);
    expect(/backdrop-filter|will-change/.test(code)).toBe(false);
    // transform is allowed only on small glyphs inside buttons (.ico-*, the split chevron svg)
    const rules = code.split('}').map((r) => r.trim()).filter((r) => /(^|[;{\s])(transform|translate|scale)\s*:(?!\s*none)/.test(r));
    for (const r of rules) {
      const selector = r.slice(0, r.indexOf('{')).replace(/@keyframes[^{]*\{/, '');
      if (!/ico-|svg|@keyframes/.test(selector)) expect.fail(`transform on a non-glyph rule: ${selector}`);
    }
  });
});
