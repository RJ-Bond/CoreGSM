/** The opt-in pull of ready images in the installer: used only when everything is verified, otherwise the usual build. */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';

const head = fs.readFileSync(path.resolve(import.meta.dirname, '../../../tools/installer-head.sh'), 'utf8');
const fn = /^pull_images\(\) \{[\s\S]*?^\}$/m.exec(head)?.[0] ?? '';

/** runs pull_images with stubs for docker and cosign; returns the exit code and what the stubs saw */
function run(opts: { optIn?: boolean; cosign?: boolean; pullFails?: string; verifyFails?: boolean }) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'coregsm-pull-'));
  const log = path.join(dir, 'log');
  const bin = path.join(dir, 'bin');
  fs.mkdirSync(bin);
  const stub = (name: string, body: string) => { fs.writeFileSync(path.join(bin, name), `#!/usr/bin/env bash\n${body}\n`); fs.chmodSync(path.join(bin, name), 0o755); };
  stub('docker', `echo "docker $*" >> "${log}"
case "$1" in
  pull) ${opts.pullFails ? `case "$3" in *coregsm-${opts.pullFails}:*) exit 1;; esac` : ':'}; exit 0;;
  image) echo "ghcr.io/rj-bond/x@sha256:abc"; exit 0;;
  tag) exit 0;;
esac`);
  if (opts.cosign !== false) stub('cosign', `echo "cosign $*" >> "${log}"; ${opts.verifyFails ? 'exit 1' : 'exit 0'}`);
  const script = `
info() { echo "info: $*"; }
warn() { echo "warn: $*"; }
env_get() { case "$1" in COREGSM_PULL_IMAGES) echo "${opts.optIn === false ? '' : '1'}";; *) echo "";; esac; }
COREGSM_BUILD=abc123def456
${fn}
pull_images
echo "exit=$?"`;
  // only the stubs (and the basic tools) are on the path: a real docker or cosign of the machine must not be reached
  const r = spawnSync('bash', ['-c', script], { encoding: 'utf8', env: { PATH: `${bin}${path.delimiter}${process.env.PATH ?? ''}`, HOME: dir } });
  const seen = fs.existsSync(log) ? fs.readFileSync(log, 'utf8') : '';
  return { out: r.stdout + r.stderr, code: Number(/exit=(\d+)/.exec(r.stdout)?.[1] ?? 99), seen };
}

describe('the installer pulls ready images only when it is safe', () => {
  it('found the function in the installer', () => assert.ok(fn.includes('cosign verify'), 'pull_images is in tools/installer-head.sh'));

  it('does nothing unless the owner opted in', () => {
    const r = run({ optIn: false });
    assert.equal(r.code, 1, r.out);
    assert.equal(r.seen, '', 'no docker call at all');
  });

  it('pulls the four images of this build, verifies each by digest and gives them the names compose uses', () => {
    const r = run({});
    assert.equal(r.code, 0, r.out);
    const pulls = r.seen.split('\n').filter((l) => l.startsWith('docker pull'));
    assert.equal(pulls.length, 4);
    assert.ok(pulls.every((l) => l.includes(':build-abc123def456')), 'by the id of this build');
    assert.equal(r.seen.split('\n').filter((l) => l.startsWith('cosign verify')).length, 4);
    assert.ok(r.seen.split('\n').filter((l) => l.startsWith('cosign verify')).every((l) => l.includes('@sha256:abc') && /release\\?\.yml@refs\/heads\/main/.test(l)), 'by digest, against the workflow identity');
    for (const svc of ['backend', 'bot', 'frontend', 'nginx-proxy']) assert.ok(r.seen.includes(`docker tag ghcr.io/rj-bond/x@sha256:abc coregsm-${svc}:latest`), svc);
  });

  it('falls back to the build when an image is missing, a signature fails or cosign is not there; nothing is tagged then', () => {
    for (const o of [{ pullFails: 'bot' }, { verifyFails: true }, { cosign: false }]) {
      const r = run(o);
      assert.equal(r.code, 1, JSON.stringify(o) + r.out);
      assert.ok(!r.seen.includes('docker tag'), `no local name is taken (${JSON.stringify(o)})`);
    }
  });
});
