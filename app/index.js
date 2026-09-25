import express from 'express';
import { readFileSync } from 'node:fs';
import agentConnections from './utils/agent-connections.js';
import morgan from 'morgan';
import { createHash, randomBytes } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import wake from './utils/wake.js';
import ping from './utils/ping.js';
import db from './utils/db.js';
import { defaultShutdownCommands } from './utils/shutdown.js';
import { createShutdownStrategy } from './strategies/shutdown.js';

const app = express();
const { version } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const publicDirectory = path.join(path.dirname(fileURLToPath(import.meta.url)), 'public');

function toBoolean(value) {
    return Buffer.isBuffer(value) ? value[0] === 1 : Boolean(value);
}

function validateInstance(body) {
    const { name, hosts, macs } = body ?? {};
    if (typeof name !== 'string' || !name.trim()) return 'A name is required.';
    if (!Array.isArray(hosts) || !Array.isArray(macs)) return 'Hosts and MAC addresses must be lists.';
    return [...hosts, ...macs].every(item => item && typeof item.address === 'string' && item.address.trim())
        ? null : 'Each host and MAC address needs a value.';
}

function tokenHash(token) {
    return createHash('sha256').update(token).digest('hex');
}

function publicStrategy(strategy) {
    return {
        id: strategy.id,
        type: strategy.type,
        platform: strategy.platform,
        host: strategy.host,
        shutdown_command: strategy.shutdown_command,
        agent_last_seen_at: strategy.agent_last_seen_at,
        agent_connected: agentConnections.has(strategy.id),
        shutdown_requested_at: strategy.shutdown_requested_at,
        has_private_key: Boolean(strategy.private_key)
    };
}

function validateStrategy(body) {
    if (!['ssh', 'remote-agent'].includes(body?.type)) return 'Choose a shutdown strategy.';
    if (body.type === 'ssh') {
        if (!['linux', 'macos', 'windows'].includes(body.platform)) return 'Choose the SSH host platform.';
        if (typeof body.host !== 'string' || !body.host.trim()) return 'An SSH host is required.';
        if (typeof body.private_key !== 'string' || !body.private_key.trim()) return 'A private key is required.';
    }
    return null;
}

async function getInstances() {
    const { results: instances } = await db.query('SELECT * FROM instance ORDER BY name');
    if (!instances.length) return [];
    const ids = instances.map(instance => instance.id);
    const [{ results: hosts }, { results: macs }, { results: strategies }] = await Promise.all([
        db.query('SELECT instance_id, address FROM instance_host WHERE instance_id IN (?) ORDER BY address', [ids]),
        db.query('SELECT instance_id, address FROM instance_mac WHERE instance_id IN (?) ORDER BY address', [ids]),
        db.query('SELECT * FROM shutdown_strategy WHERE instance_id IN (?) ORDER BY id', [ids])
    ]);
    const byInstance = new Map(instances.map(instance => [instance.id, {
        ...instance, active: toBoolean(instance.active), hosts: [], macs: [], shutdown_strategies: []
    }]));
    hosts.forEach(host => byInstance.get(host.instance_id).hosts.push({ address: host.address }));
    macs.forEach(mac => byInstance.get(mac.instance_id).macs.push({ address: mac.address }));
    strategies.forEach(strategy => byInstance.get(strategy.instance_id).shutdown_strategies.push(publicStrategy(strategy)));
    const hydratedInstances = [...byInstance.values()];

    await Promise.all(hydratedInstances.map(async instance => {
        if (!instance.hosts.length) {
            instance.state = 'no-host';
            return;
        }

        const responses = await Promise.all(instance.hosts.map(host => ping(host.address)));
        instance.state = responses.some(Boolean) ? 'awake' : 'asleep';
    }));

    return hydratedInstances;
}

app.use(morgan('dev'));
app.use(express.json());
app.use(express.static(publicDirectory));

app.get('/version', (_req, res) => res.set('Cache-Control', 'no-store').json({ version }));

app.get('/instances', async (req, res) => res.json(await getInstances()));

app.post('/instances', async (req, res) => {
    const validationError = validateInstance(req.body);
    if (validationError) return res.status(400).json({ error: validationError });
    let instance;
    await db.usingTransaction(async (tx) => {
        const { name, active, hosts, macs } = req.body;
        instance = await tx.create('instance', { name: name.trim(), active: Boolean(active) });
        instance.hosts = hosts.map(host => ({ instance_id: instance.id, address: host.address.trim() }));
        instance.macs = macs.map(mac => ({ instance_id: instance.id, address: mac.address.trim() }));
        await tx.bulkInsert('instance_host', instance.hosts);
        await tx.bulkInsert('instance_mac', instance.macs);
    });
    res.status(201).json({ ...instance, active: toBoolean(instance.active) });
});

app.put('/instances/:instance', async (req, res) => {
    const validationError = validateInstance(req.body);
    if (validationError) return res.status(400).json({ error: validationError });
    await db.usingTransaction(async (tx) => {
        const { instance } = req.params;
        const { name, active, hosts, macs } = req.body;
        await tx.update('instance', instance, { name: name.trim(), active: Boolean(active) });
        await tx.query('DELETE FROM instance_host WHERE instance_id = ?', [instance]);
        await tx.bulkInsert('instance_host', hosts.map(host => ({ instance_id: instance, address: host.address.trim() })));
        await tx.query('DELETE FROM instance_mac WHERE instance_id = ?', [instance]);
        await tx.bulkInsert('instance_mac', macs.map(mac => ({ instance_id: instance, address: mac.address.trim() })));
    });
    res.sendStatus(204);
});

app.delete('/instances/:instance', async (req, res) => {
    await db.usingTransaction(async (tx) => {
        const { instance } = req.params;
        await tx.query('DELETE FROM instance_host WHERE instance_id = ?', [instance]);
        await tx.query('DELETE FROM instance_mac WHERE instance_id = ?', [instance]);
        await tx.delete('instance', instance);
    });
    agentConnections.disconnectInstance(req.params.instance);
    res.sendStatus(204);
});

app.post('/instances/:instance/shutdown-strategies', async (req, res) => {
    const validationError = validateStrategy(req.body);
    if (validationError) return res.status(400).json({ error: validationError });

    const { type, platform, host, private_key: privateKey, shutdown_command: shutdownCommand } = req.body;
    const row = {
        instance_id: Number(req.params.instance),
        type,
        platform: type === 'ssh' ? platform : null,
        host: type === 'ssh' ? host.trim() : null,
        private_key: type === 'ssh' ? privateKey.trim() : null,
        shutdown_command: type === 'ssh' ? (shutdownCommand?.trim() || defaultShutdownCommands[platform]) : null
    };
    let enrollmentToken;
    if (type === 'remote-agent') {
        enrollmentToken = randomBytes(32).toString('base64url');
        row.agent_token_hash = tokenHash(enrollmentToken);
    }
    const strategy = await db.create('shutdown_strategy', row);
    res.status(201).json({ ...publicStrategy(strategy), enrollment_token: enrollmentToken });
});

app.delete('/instances/:instance/shutdown-strategies/:strategy', async (req, res) => {
    const { results } = await db.query('DELETE FROM shutdown_strategy WHERE id = ? AND instance_id = ?', [req.params.strategy, req.params.instance]);
    if (results.affectedRows) agentConnections.disconnect(req.params.strategy);
    res.sendStatus(204);
});

app.post('/instances/:instance/shutdown', async (req, res) => {
    const { results: strategies } = await db.query('SELECT * FROM shutdown_strategy WHERE instance_id = ?', [req.params.instance]);
    if (!strategies.length) return res.status(409).json({ error: 'No shutdown strategy is configured for this instance.' });

    const results = await Promise.all(strategies.map(strategy => createShutdownStrategy(strategy).execute()));
    res.status(202).json({ results });
});

async function findRemoteAgent(token) {
    if (typeof token !== 'string' || !token) return null;
    const { results } = await db.query(
        'SELECT * FROM shutdown_strategy WHERE type = ? AND agent_token_hash = ? LIMIT 1',
        ['remote-agent', tokenHash(token)]
    );
    return results[0] ?? null;
}

function agentToken(req) {
    const authorization = req.get('authorization');
    return authorization?.startsWith('Bearer ') ? authorization.slice(7) : req.body?.token;
}

app.get('/agent/events', async (req, res) => {
    const strategy = await findRemoteAgent(agentToken(req));
    if (!strategy) return res.sendStatus(401);
    await db.update('shutdown_strategy', strategy.id, { agent_last_seen_at: new Date() });
    if (res.destroyed) return;
    agentConnections.connect(strategy, res);
    try {
        // Subscribe before reading the queue so a concurrent shutdown cannot be missed.
        const current = await db.find('shutdown_strategy', strategy.id);
        if (!current) return agentConnections.disconnect(strategy.id);
        agentConnections.send(strategy.id, current.shutdown_request_id);
    } catch (error) {
        res.destroy();
        console.error('Unable to read queued agent command:', error.message);
    }
});

app.post('/agent/commands/:request/complete', async (req, res) => {
    const strategy = await findRemoteAgent(agentToken(req));
    if (!strategy) return res.sendStatus(401);
    // Only one agent may claim this command; stale acknowledgements cannot clear a newer one.
    const { results } = await db.query(
        'UPDATE shutdown_strategy SET shutdown_request_id = NULL, shutdown_requested_at = NULL, agent_last_seen_at = ? WHERE id = ? AND shutdown_request_id = ?',
        [new Date(), strategy.id, req.params.request]
    );
    if (!results.affectedRows) return res.sendStatus(409);
    res.sendStatus(204);
});

app.post('/instances/:instance/wake', async (req, res) => {
    await db.usingTransaction(async tx => {
        const { results: macs } = await tx.query('SELECT address FROM instance_mac WHERE instance_id = ?', [req.params.instance]);
        for (const mac of macs) await wake(mac.address);
        await tx.update('instance', Number(req.params.instance), { last_wake_request: new Date() });
    });
    res.sendStatus(204);
});

export default app;
