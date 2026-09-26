import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile, chmod } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

const execute = promisify(execFile);

export const defaultShutdownCommands = {
    linux: 'sudo shutdown -h now',
    macos: 'sudo shutdown -h now',
    windows: 'shutdown /s /t 0'
};

export function normalizeSshHost(host) {
    return String(host).trim().replace(/\\@/g, '@');
}

export function commandForSshHost(command, host) {
    const normalizedHost = normalizeSshHost(host);
    const username = normalizedHost.match(/^([^@]+)@/)?.[1];
    if (username?.toLowerCase() === 'root' && command === defaultShutdownCommands.linux) return 'shutdown -h now';
    return command;
}

export async function shutdownOverSsh({ host, private_key: privateKey, shutdown_command: command }) {
    const target = normalizeSshHost(host);
    const directory = await mkdtemp(path.join(tmpdir(), 'wake-ssh-'));
    const keyPath = path.join(directory, 'identity');
    try {
        await writeFile(keyPath, privateKey, { mode: 0o600 });
        await chmod(keyPath, 0o600);
        await execute('ssh', ['-i', keyPath, '-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=accept-new', '--', target, commandForSshHost(command, target)], { timeout: 20_000 });
    } catch (error) {
        const details = `${error.stderr || ''}\n${error.message || ''}`;
        if (/Load key .*error in libcrypto/i.test(details)) {
            throw new Error('Wake could not read this SSH key. Paste the full, unencrypted private key, not its .pub file or a PuTTY .ppk key.');
        }
        if (/Permission denied \(publickey/i.test(details)) {
            throw new Error(`SSH authentication was denied for ${target}. Check the username and confirm this key's public key is in that account's authorized_keys.`);
        }
        throw new Error(error.stderr?.trim() || error.message || 'SSH shutdown failed.');
    } finally {
        await rm(directory, { recursive: true, force: true });
    }
}
