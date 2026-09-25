import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, appendFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const semver = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
export function bumpVersion(version, message) {
    if (!semver.test(version)) throw new Error(`Invalid release version: ${version}`);
    let [major, minor, patch] = version.split('.').map(BigInt);
    if (/(^|\s)#major(?=$|\s|[.,!?:;])/i.test(message)) return `${major + 1n}.0.0`;
    if (/(^|\s)#minor(?=$|\s|[.,!?:;])/i.test(message)) return `${major}.${minor + 1n}.0`;
    return `${major}.${minor}.${patch + 1n}`;
}

function compare(a, b) {
    const left = a.split('.').map(BigInt);
    const right = b.split('.').map(BigInt);
    for (let i = 0; i < 3; i++) {
        if (left[i] !== right[i]) return left[i] > right[i] ? 1 : -1;
    }
    return 0;
}

export function versionBuild(directory = process.cwd()) {
    const git = (...args) => execFileSync('git', args, { cwd: directory, encoding: 'utf8' }).trim();
    const releaseTags = text => text.split('\n').filter(tag => tag.startsWith('v') && semver.test(tag.slice(1)))
        .map(tag => tag.slice(1)).sort(compare);
    const packagePath = `${directory}/package.json`;
    const lockPath = `${directory}/package-lock.json`;
    const pkg = JSON.parse(readFileSync(packagePath, 'utf8'));
    const lock = JSON.parse(readFileSync(lockPath, 'utf8'));
    if (!semver.test(pkg.version)) throw new Error('package.json must contain a stable semantic version.');
    const existing = releaseTags(git('tag', '--points-at', 'HEAD')).at(-1);
    const latest = releaseTags(git('tag', '--list')).at(-1);
    const baseline = latest && compare(latest, pkg.version) > 0 ? latest : pkg.version;
    const version = existing || bumpVersion(baseline, git('log', '-1', '--format=%B'));
    pkg.version = version;
    lock.version = version;
    lock.packages[''].version = version;
    writeFileSync(packagePath, `${JSON.stringify(pkg, null, 2)}\n`);
    writeFileSync(lockPath, `${JSON.stringify(lock, null, 2)}\n`);
    return version;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    const version = versionBuild();
    console.log(`Building Wake v${version}`);
    if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `version=${version}\n`);
}
