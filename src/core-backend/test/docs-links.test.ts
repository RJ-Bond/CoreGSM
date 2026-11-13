/** The documentation does not point at files that are gone: every relative link of the Markdown files leads somewhere. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';

const root = path.resolve(import.meta.dirname, '../../..');
const FILES = ['README.md', 'README.en.md', 'CONTRIBUTING.md', 'SECURITY.md'];
const walk = (dir: string): string[] => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : e.name.endsWith('.md') ? [path.join(dir, e.name)] : []));

/** the targets of the links `[text](target)` outside code blocks, without the addresses of other sites and the anchors */
export function linkTargets(md: string): string[] {
  const text = md.replace(/```[\s\S]*?```/g, '').replace(/`[^`\n]*`/g, '');
  const out: string[] = [];
  for (const m of text.matchAll(/\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g)) {
    const t = m[1];
    if (/^(?:[a-z][a-z0-9+.-]*:|#|\/\/)/i.test(t)) continue;
    out.push(decodeURI(t.split('#')[0].split('?')[0]));
  }
  return out.filter(Boolean);
}

describe('documentation links', () => {
  it('finds the links and skips code, anchors and other sites', () => {
    assert.deepEqual(linkTargets('[a](docs/x.md#top) [b](https://e.com) [c](#here) `[d](no.md)` [e](y.md "t")'), ['docs/x.md', 'y.md']);
  });

  it('every relative link of the Markdown files points at a file or a folder that exists', () => {
    const files = [...FILES.map((f) => path.join(root, f)).filter((f) => fs.existsSync(f)), ...walk(path.join(root, 'docs'))];
    assert.ok(files.length >= 8, 'the documents are found');
    const broken: string[] = [];
    for (const f of files) {
      for (const t of linkTargets(fs.readFileSync(f, 'utf8'))) {
        const target = t.startsWith('/') ? path.join(root, t) : path.resolve(path.dirname(f), t);
        if (!fs.existsSync(target)) broken.push(`${path.relative(root, f).split(path.sep).join('/')} -> ${t}`);
      }
    }
    assert.deepEqual(broken, [], 'broken links');
  });
});
