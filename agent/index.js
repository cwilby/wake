import { exec } from 'node:child_process';
import { promisify } from 'node:util';

const execute = promisify(exec);
const wakeUrl = process.env.WAKE_URL?.replace(/\/$/, '');
const token = process.env.WAKE_TOKEN;
const shutdownCommand = process.env.WAKE_SHUTDOWN_COMMAND || 'sudo shutdown -h now';
const pollInterval = Number(process.env.WAKE_POLL_INTERVAL_MS || 5_000);

if (!wakeUrl || !token) {
    throw new Error('WAKE_URL and WAKE_TOKEN are required.');
}

async function request(path) {
    const response = await fetch(`${wakeUrl}${path}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ token })
    });
    if (!response.ok) throw new Error(`Wake returned ${response.status}.`);
    return response.status === 204 ? null : response.json();
}

async function poll() {
    try {
        const command = await request('/agent/commands/next');
        if (!command.shutdown) return;

        await request(`/agent/commands/${command.request_id}/complete`);
        console.log('Shutdown request acknowledged; running local shutdown command.');
        await execute(shutdownCommand);
    } catch (error) {
        console.error(`Agent poll failed: ${error.message}`);
    }
}

await poll();
setInterval(poll, pollInterval);
