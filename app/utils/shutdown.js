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

export async function shutdownOverSsh({ host, private_key: privateKey, shutdown_command: command }) {
    const directory = await mkdtemp(path.join(tmpdir(), 'wake-ssh-'));
    const keyPath = path.join(directory, 'identity');
    try {
        await writeFile(keyPath, privateKey, { mode: 0o600 });
        await chmod(keyPath, 0o600);
        await execute('ssh', ['-i', keyPath, '-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=accept-new', '--', host, command], { timeout: 20_000 });
    } finally {
        await rm(directory, { recursive: true, force: true });
    }
}
