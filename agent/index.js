import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { pathToFileURL } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';

const execute = promisify(exec);
// Fetch chunks may split a line or contain several events (including heartbeats).
export async function* readCommands(body, onActivity = () => {}) {
    const decoder = new TextDecoder();
    let buffer = '';
    for await (const chunk of body) {
        onActivity();
        buffer += decoder.decode(chunk, { stream: true });
        let boundary;
        while ((boundary = buffer.indexOf('\n\n')) !== -1) {
            const event = buffer.slice(0, boundary);
            buffer = buffer.slice(boundary + 2);
            const data = event.split('\n').filter(line => line.startsWith('data:'))
                .map(line => line.slice(5).trimStart()).join('\n');
            if (data) yield JSON.parse(data);
        }
        if (buffer.length > 64 * 1024) throw new Error('Agent event exceeded the size limit.');
    }
}

export async function runAgent({
    wakeUrl, token, shutdownCommand = 'sudo shutdown -h now',
    signal, executeCommand = execute, fetchRequest = fetch,
    heartbeatTimeoutMs = 75_000, reconnectBaseMs = 1_000, reconnectMaxMs = 60_000,
    logger = console
}) {
    if (!wakeUrl || !token) throw new Error('WAKE_URL and WAKE_TOKEN are required.');
    const baseUrl = wakeUrl.replace(/\/$/, '');
    const headers = { authorization: `Bearer ${token}` };
    let reconnectDelay = reconnectBaseMs;
    while (!signal?.aborted) {
        const connection = new AbortController();
        const abort = () => connection.abort();
        signal?.addEventListener('abort', abort, { once: true });
        let watchdog;
        const touch = () => {
            clearTimeout(watchdog);
            watchdog = setTimeout(abort, heartbeatTimeoutMs);
        };
        const started = Date.now();
        try {
            touch();
            const response = await fetchRequest(`${baseUrl}/agent/events`, {
                headers: { ...headers, accept: 'text/event-stream' },
                signal: connection.signal,
                redirect: 'error'
            });
            if (!response.ok) {
                const error = new Error(`Wake returned ${response.status}.`);
                error.authenticationFailed = response.status === 401 || response.status === 403;
                await response.body?.cancel();
                throw error;
            }
            if (!response.headers.get('content-type')?.startsWith('text/event-stream')) {
                await response.body?.cancel();
                throw new Error('Wake did not return an agent event stream.');
            }
            logger.log('Connected to Wake; waiting for shutdown requests.');
            for await (const command of readCommands(response.body, touch)) {
                if (signal?.aborted) break;
                if (command.shutdown !== true || typeof command.request_id !== 'string') continue;
                const acknowledgement = await fetchRequest(`${baseUrl}/agent/commands/${encodeURIComponent(command.request_id)}/complete`, {
                    method: 'POST', headers, redirect: 'error',
                    signal: AbortSignal.any([connection.signal, AbortSignal.timeout(15_000)])
                });
                await acknowledgement.body?.cancel();
                // A duplicate delivery or another agent has already claimed this request.
                if (acknowledgement.status === 409) continue;
                if (!acknowledgement.ok) throw new Error(`Acknowledgement failed (${acknowledgement.status}).`);
                logger.log('Shutdown request acknowledged; running local shutdown command.');
                try {
                    await executeCommand(shutdownCommand);
                } catch (error) {
                    logger.error(`Local shutdown failed: ${error.message}`);
                }
            }
            if (!signal?.aborted) throw new Error('Wake closed the connection.');
        } catch (error) {
            if (signal?.aborted) break;
            if (error.authenticationFailed) throw new Error('Agent token rejected. Check WAKE_TOKEN or enroll a new agent.');
            logger.error(`Agent connection interrupted: ${error.message}`);
        } finally {
            clearTimeout(watchdog);
            connection.abort();
            signal?.removeEventListener('abort', abort);
        }
        if (signal?.aborted) break;
        // Only reset after a stable connection, avoiding rapid loops if a proxy closes immediately.
        if (Date.now() - started >= 60_000) reconnectDelay = reconnectBaseMs;
        const delay = Math.min(reconnectMaxMs, reconnectDelay * (1 + Math.random() * 0.25));
        try {
            await sleep(delay, undefined, { signal });
        } catch (error) {
            if (signal?.aborted) break;
            throw error;
        }
        reconnectDelay = Math.min(reconnectMaxMs, reconnectDelay * 2);
    }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    const stop = new AbortController();
    process.once('SIGINT', () => stop.abort());
    process.once('SIGTERM', () => stop.abort());
    await runAgent({
        wakeUrl: process.env.WAKE_URL,
        token: process.env.WAKE_TOKEN,
        shutdownCommand: process.env.WAKE_SHUTDOWN_COMMAND,
        signal: stop.signal
    });
}
