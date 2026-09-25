import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { setTimeout as sleep } from 'node:timers/promises';
import { createHash } from 'node:crypto';
import { readCommands, runAgent } from '../agent/index.js';
import app from '../app/index.js';
import db from '../app/utils/db.js';
import connections from '../app/utils/agent-connections.js';

const logger = { log() {}, error() {} };
const token = 'test-agent-token';
const headers = { authorization: `Bearer ${token}` };

async function until(check) {
    for (let i = 0; i < 200; i++) {
        if (check()) return;
        await sleep(10);
    }
    assert.fail('Timed out waiting for condition');
}

test('event parser handles fragmented, combined, and heartbeat frames', async () => {
    async function* chunks() {
        for (const text of [': heart', 'beat\n\ndata: {"shutdown":true,', '"request_id":"a"}\n', '\ndata: {"request_id":"b"}\n\n']) {
            yield Buffer.from(text);
        }
    }
    const commands = [];
    for await (const command of readCommands(chunks())) commands.push(command);
    assert.deepEqual(commands, [{ shutdown: true, request_id: 'a' }, { request_id: 'b' }]);
});

test('persistent agent lifecycle and authenticated command delivery', async t => {
    let row;
    let streamRequests = 0;
    let acknowledgements = 0;
    const original = { query: db.query, find: db.find, update: db.update };
    db.find = async () => row ? { ...row } : null;
    db.update = async (_table, _id, values) => { if (row) Object.assign(row, values); };
    db.query = async (sql, args) => {
        if (sql.startsWith('SELECT') && sql.includes('agent_token_hash')) {
            streamRequests++;
            return { results: row && args[1] === row.agent_token_hash ? [{ ...row }] : [] };
        }
        if (sql.startsWith('SELECT')) return { results: row ? [{ ...row }] : [] };
        if (sql.includes('COALESCE')) {
            row.shutdown_request_id ??= args[0];
            row.shutdown_requested_at ??= args[1];
            return { results: { affectedRows: 1 } };
        }
        if (sql.includes('shutdown_request_id = NULL')) {
            const matched = row && row.shutdown_request_id === args[2];
            if (matched) {
                row.shutdown_request_id = null;
                acknowledgements++;
            }
            return { results: { affectedRows: matched ? 1 : 0 } };
        }
        if (sql.startsWith('DELETE')) {
            row = null;
            return { results: { affectedRows: 1 } };
        }
        throw new Error(`Unexpected query: ${sql}`);
    };
    connections.heartbeatMs = 20;
    const server = app.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const wakeUrl = `http://127.0.0.1:${server.address().port}`;
    t.after(() => {
        connections.disconnect(1);
        server.closeAllConnections();
        server.close();
        Object.assign(db, original);
        connections.heartbeatMs = 25_000;
    });
    function reset() {
        connections.disconnect(1);
        row = { id: 1, instance_id: 1, type: 'remote-agent', shutdown_request_id: null,
            agent_token_hash: createHash('sha256').update(token).digest('hex') };
    }
    async function queue() {
        const response = await fetch(`${wakeUrl}/instances/1/shutdown`, { method: 'POST' });
        assert.equal(response.status, 202);
        return (await response.json()).results[0].requestId;
    }

    await t.test('rejects invalid credentials without opening a stream', async () => {
        reset();
        const response = await fetch(`${wakeUrl}/agent/events`, { headers: { authorization: 'Bearer invalid' } });
        assert.equal(response.status, 401);
        await response.text();
        assert.equal(connections.has(1), false);
        await assert.rejects(runAgent({ wakeUrl, token: 'invalid', logger }), /token rejected/);
    });

    await t.test('keeps one idle connection, pushes immediately, and skips duplicates', async () => {
        reset();
        const stop = new AbortController();
        let executions = 0;
        const running = runAgent({ wakeUrl, token, logger, signal: stop.signal, executeCommand: async () => { executions++; } });
        try {
            await until(() => connections.has(1));
            const before = streamRequests;
            await sleep(100);
            assert.equal(streamRequests, before, 'heartbeats must not create new requests');
            const requestId = await queue();
            await until(() => executions === 1);
            assert.equal(row.shutdown_request_id, null);
            // Simulate duplicate transport delivery after successful acknowledgement.
            connections.clients.get(1).res.write(`data: ${JSON.stringify({ shutdown: true, request_id: requestId })}\n\n`);
            await sleep(50);
            assert.equal(executions, 1);
            assert.equal(acknowledgements, 1);
        } finally {
            stop.abort();
            await running;
        }
    });

    await t.test('coalesces offline commands and delivers after reconnect', async () => {
        reset();
        const requestId = await queue();
        assert.equal(await queue(), requestId);
        const stop = new AbortController();
        let executions = 0;
        const running = runAgent({ wakeUrl, token, logger, signal: stop.signal, reconnectBaseMs: 10, reconnectMaxMs: 20,
            executeCommand: async () => { executions++; } });
        try {
            await until(() => executions === 1);
            connections.disconnect(1);
            const nextId = await queue();
            assert.notEqual(nextId, requestId);
            await until(() => executions === 2);
        } finally {
            stop.abort();
            await running;
        }
    });

    await t.test('missing heartbeats trigger reconnection instead of hanging', async () => {
        reset();
        connections.heartbeatMs = 1_000;
        const stop = new AbortController();
        let attempts = 0;
        const running = runAgent({ wakeUrl, token, logger, signal: stop.signal,
            heartbeatTimeoutMs: 40, reconnectBaseMs: 10, reconnectMaxMs: 20,
            fetchRequest: (...args) => { attempts++; return fetch(...args); },
            executeCommand: async () => assert.fail('No shutdown was requested') });
        try {
            await until(() => attempts >= 2);
        } finally {
            stop.abort();
            await running;
            connections.heartbeatMs = 20;
        }
    });

    await t.test('failed acknowledgement reconnects and retries without executing early', async () => {
        reset();
        await queue();
        const stop = new AbortController();
        let attempts = 0;
        let executions = 0;
        const running = runAgent({ wakeUrl, token, logger, signal: stop.signal,
            reconnectBaseMs: 10, reconnectMaxMs: 20,
            fetchRequest: (url, options) => {
                if (url.endsWith('/complete') && ++attempts === 1) {
                    assert.equal(executions, 0);
                    return Promise.resolve(new Response('', { status: 503 }));
                }
                return fetch(url, options);
            },
            executeCommand: async () => { executions++; } });
        try {
            await until(() => executions === 1);
            assert.equal(attempts, 2);
            assert.equal(row.shutdown_request_id, null);
        } finally {
            stop.abort();
            await running;
        }
    });

    await t.test('stale acknowledgement cannot clear a newer request', async () => {
        reset();
        const id = await queue();
        const response = await fetch(`${wakeUrl}/agent/commands/stale/complete`, { method: 'POST', headers });
        assert.equal(response.status, 409);
        await response.text();
        assert.equal(row.shutdown_request_id, id);
    });

    await t.test('replacement stream survives cleanup of old stream; deletion disconnects it', async () => {
        reset();
        const first = await fetch(`${wakeUrl}/agent/events`, { headers });
        const second = await fetch(`${wakeUrl}/agent/events`, { headers });
        await first.text();
        assert.equal(connections.has(1), true);
        const response = await fetch(`${wakeUrl}/instances/1/shutdown-strategies/1`, { method: 'DELETE' });
        assert.equal(response.status, 204);
        await second.text();
        assert.equal(connections.has(1), false);
    });
});
