// Run with: node --test publish.test.mjs
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const script = fileURLToPath(new URL('./publish.sh', import.meta.url));
const pnpm = spawnSync('bash', ['-c', 'command -v pnpm'], { encoding: 'utf8' }).stdout.trim();

function fixture(t, { baseline = true, change = 'definition' } = {}) {
  const directory = mkdtempSync(join(tmpdir(), 'kinetic-release-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const repo = join(directory, 'repo');
  const bin = join(directory, 'bin');
  const log = join(directory, 'commands');
  mkdirSync(repo);
  mkdirSync(bin);
  writeFileSync(log, '');

  // Use real pnpm selection/versioning, but never build or contact a registry.
  writeFileSync(join(bin, 'pnpm'), `#!/bin/bash
set -euo pipefail
printf '%s\\n' "$*" >> "$RELEASE_TEST_LOG"
case "$*" in
  '-r clean'|'-r build') exit 0 ;;
esac
for arg in "$@"; do
  if [ "$arg" = publish ]; then
    exit "\${RELEASE_TEST_PUBLISH_STATUS:-0}"
  fi
done
exec "$RELEASE_TEST_PNPM" "$@"
`, { mode: 0o755 });

  function run(command, args, env = {}) {
    return spawnSync(command, args, {
      cwd: repo,
      encoding: 'utf8',
      env: {
        ...process.env,
        CI: 'true',
        PATH: `${bin}:${process.env.PATH}`,
        RELEASE_TEST_PNPM: pnpm,
        RELEASE_TEST_LOG: log,
        ...env,
      },
    });
  }
  function git(...args) {
    const result = run('git', args);
    assert.equal(result.status, 0, result.stderr);
    return result.stdout.trim();
  }
  function manifest(path, contents) {
    mkdirSync(join(repo, path), { recursive: true });
    writeFileSync(join(repo, path, 'package.json'), `${JSON.stringify(contents, null, 2)}\n`);
  }
  const name = (path) => `@release-test/${path}`;
  manifest('.', { name: name('root'), private: true });
  for (const path of ['definition', 'url', 'solid', 'untouched']) {
    manifest(path, {
      name: name(path),
      version: '1.0.0',
      ...(path === 'url' || path === 'solid'
        ? { dependencies: { [name(path === 'url' ? 'definition' : 'url')]: 'workspace:*' } }
        : {}),
    });
  }
  for (const path of ['example-app', 'integration-tests', 'testing-utils']) {
    manifest(path, {
      name: name(path),
      private: true,
      ...(path === 'example-app' ? { version: '1.0.0' } : {}),
      dependencies: { [name('solid')]: 'workspace:*' },
    });
  }
  writeFileSync(join(repo, 'pnpm-workspace.yaml'), "packages:\n  - '*'\n");
  writeFileSync(join(repo, '.gitignore'), 'node_modules/\n');
  git('init', '-q', '-b', 'main');
  git('config', 'user.name', 'Release test');
  git('config', 'user.email', 'release-test@example.invalid');
  git('config', 'commit.gpgsign', 'false');
  git('config', 'core.hooksPath', '/dev/null');
  git('add', '.');
  git('commit', '-qm', 'Initial packages');
  if (baseline) git('branch', 'published');
  if (change) {
    writeFileSync(join(repo, change, 'change.txt'), 'changed\n');
    git('add', '.');
    git('commit', '-qm', 'Change package');
  }
  return {
    repo,
    git,
    release: (env) => run('bash', [script], env),
    calls: () => readFileSync(log, 'utf8').trim().split('\n').filter(Boolean),
    version: (path) => JSON.parse(readFileSync(join(repo, path, 'package.json'), 'utf8')).version,
  };
}

function succeeded(result) {
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
}

test('bumps and publishes only changed public packages and their dependents', (t) => {
  const f = fixture(t);
  const before = f.git('rev-parse', 'HEAD');
  succeeded(f.release());
  for (const path of ['definition', 'url', 'solid']) assert.equal(f.version(path), '1.0.1');
  assert.equal(f.version('untouched'), '1.0.0');
  assert.equal(f.version('example-app'), '1.0.0');
  assert.equal(f.version('integration-tests'), undefined);
  assert.equal(f.git('rev-list', '--count', `${before}..HEAD`), '1');
  assert.equal(f.git('tag', '--list'), '');
  assert.equal(f.git('rev-parse', 'published'), f.git('rev-parse', 'HEAD'));
  assert.equal(f.git('status', '--porcelain'), '');
  const commands = f.calls().filter((call) => / (version|publish) /.test(call));
  assert.equal(commands.length, 2);
  for (const command of commands) {
    const selected = [...command.matchAll(/--filter (\S+)/g)].map((match) => match[1]).sort();
    assert.deepEqual(selected, ['definition', 'solid', 'url'].map((path) => `@release-test/${path}`));
  }
  assert.match(commands[0], /--no-git-tag-version/);
});

for (const change of [null, 'integration-tests']) {
  test(`skips release with ${change ? 'only private changes' : 'no changes'}`, (t) => {
    const f = fixture(t, { change });
    const before = f.git('rev-parse', 'HEAD');
    succeeded(f.release());
    assert.equal(f.git('rev-parse', 'HEAD'), before);
    assert.equal(f.version('definition'), '1.0.0');
    assert.equal(f.calls().length, 1);
  });
}

test('first release includes every public package', (t) => {
  const f = fixture(t, { baseline: false, change: null });
  succeeded(f.release());
  for (const path of ['definition', 'url', 'solid', 'untouched']) assert.equal(f.version(path), '1.0.1');
  assert.equal(f.git('rev-parse', 'published'), f.git('rev-parse', 'HEAD'));
});

for (const baseline of [true, false]) {
  test(`failed publishing does not ${baseline ? 'advance' : 'create'} the release marker`, (t) => {
    const f = fixture(t, { baseline });
    const before = baseline ? f.git('rev-parse', 'published') : null;
    const result = f.release({ RELEASE_TEST_PUBLISH_STATUS: '42' });
    assert.equal(result.status, 42, `${result.stdout}\n${result.stderr}`);
    assert.equal(f.git('branch', '--list', 'published').trim(), baseline ? 'published' : '');
    if (baseline) assert.equal(f.git('rev-parse', 'published'), before);
  });
}

test('refuses a dirty working tree before running pnpm', (t) => {
  const f = fixture(t);
  writeFileSync(join(f.repo, 'uncommitted.txt'), 'keep me\n');
  assert.equal(f.release().status, 1);
  assert.deepEqual(f.calls(), []);
  assert.equal(f.version('definition'), '1.0.0');
});
