import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execute = promisify(execFile);

/** Check one host on demand. No result is persisted or scheduled. */
export default async function ping(address) {
    try {
        await execute('ping', ['-c', '1', '-W', '1', address], { timeout: 2_000 });
        return true;
    } catch {
        return false;
    }
}
