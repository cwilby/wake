import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { bumpVersion, versionBuild } from '../scripts/version.mjs';

test('semantic bump rules, reset behavior, and marker precedence', () => {
    assert.equal(bumpVersion('1.2.9', 'Fix a bug'), '1.2.10');
    assert.equal(bumpVersion('1.2.9', 'Add a feature #minor'), '1.3.0');
    assert.equal(bumpVersion('1.2.9', 'Breaking change\n\n#major'), '2.0.0');
    assert.equal(bumpVersion('1.2.9', '#minor #major'), '2.0.0');
    assert.equal(bumpVersion('1.2.9', '#minority'), '1.2.10');
    assert.throws(() => bumpVersion('01.2.3', '#major'), /Invalid/);
});

test('build persists both manifests, advances from tags, and reuses a tagged commit', t => {
    const directory = mkdtempSync(join(tmpdir(), 'wake-version-'));
    t.after(() => rmSync(directory, { recursive: true, force: true }));
    const git = (...args) => execFileSync('git', args, { cwd: directory, stdio: 'pipe', env: {
        ...process.env, GIT_AUTHOR_NAME: 'Test', GIT_AUTHOR_EMAIL: 'test@example.invalid',
        GIT_COMMITTER_NAME: 'Test', GIT_COMMITTER_EMAIL: 'test@example.invalid'
    } });
    writeFileSync(join(directory, 'package.json'), JSON.stringify({ version: '1.0.0' }));
    writeFileSync(join(directory, 'package-lock.json'), JSON.stringify({ version: '1.0.0', packages: { '': { version: '1.0.0' } } }));
    git('init');
    git('add', '.');
    git('-c', 'commit.gpgsign=false', 'commit', '-m', 'Initial build');
    assert.equal(versionBuild(directory), '1.0.1');
    git('tag', 'v1.0.1');
    assert.equal(versionBuild(directory), '1.0.1', 'retry must not allocate another version');
    git('-c', 'commit.gpgsign=false', 'commit', '--allow-empty', '-m', 'New capability #minor');
    // Simulate a fresh checkout with the original package version.
    git('restore', 'package.json', 'package-lock.json');
    assert.equal(versionBuild(directory), '1.1.0');
    const pkg = JSON.parse(readFileSync(join(directory, 'package.json')));
    const lock = JSON.parse(readFileSync(join(directory, 'package-lock.json')));
    assert.equal(pkg.version, '1.1.0');
    assert.equal(lock.version, pkg.version);
    assert.equal(lock.packages[''].version, pkg.version);
    git('tag', 'v1.1.0');
    git('-c', 'commit.gpgsign=false', 'commit', '--allow-empty', '-m', 'New API #major');
    assert.equal(versionBuild(directory), '2.0.0');
});
