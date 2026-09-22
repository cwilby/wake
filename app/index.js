import express from 'express';
import morgan from 'morgan';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import wake from './utils/wake.js';
import db from './utils/db.js';

const app = express();
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

async function getInstances() {
    const { results: instances } = await db.query('SELECT * FROM instance ORDER BY name');
    if (!instances.length) return [];
    const ids = instances.map(instance => instance.id);
    const [{ results: hosts }, { results: macs }] = await Promise.all([
        db.query('SELECT instance_id, address FROM instance_host WHERE instance_id IN (?) ORDER BY address', [ids]),
        db.query('SELECT instance_id, address FROM instance_mac WHERE instance_id IN (?) ORDER BY address', [ids])
    ]);
    const byInstance = new Map(instances.map(instance => [instance.id, {
        ...instance, active: toBoolean(instance.active), hosts: [], macs: []
    }]));
    hosts.forEach(host => byInstance.get(host.instance_id).hosts.push({ address: host.address }));
    macs.forEach(mac => byInstance.get(mac.instance_id).macs.push({ address: mac.address }));
    return [...byInstance.values()];
}

app.use(morgan('dev'));
app.use(express.json());
app.use(express.static(publicDirectory));

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
