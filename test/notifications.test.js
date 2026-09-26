import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createNotificationService } from '../app/services/notifications.js';

class Response extends EventEmitter {
    text = '';
    set(headers) { this.headers = headers; }
    flushHeaders() {}
    write(chunk) { this.text += chunk; return true; }
    destroy() { this.destroyed = true; this.emit('close'); }
}

test('notification history and live events reach dashboard; desktop routing is explicit', async () => {
    const history = [];
    const desktop = [];
    const service = createNotificationService({
        database: {
            create: async (_table, row) => { const saved = { ...row, id: history.length + 1 }; history.push(saved); return saved; },
            find: async () => ({ name: 'Desktop' }),
            query: async () => ({ results: history })
        },
        agents: { notifyInstance: (id, notice) => desktop.push({ id, notice }) }
    });
    await service.forMachine(1, { type: 'wake_requested', title: 'Start requested', message: 'Wake packets sent.' });
    let connect;
    service.register({ get: (path, route) => { assert.equal(path, '/notifications/events'); connect = route; } });
    const res = new Response();
    try {
        await connect({}, res);
        assert.match(res.text, /event: snapshot/);
        assert.match(res.text, /Desktop · Start requested/);
        assert.equal(desktop.length, 0);
        await service.forMachine(1, { type: 'shutdown_warning', title: 'Shutdown soon', message: 'Save your work.', desktop: true, expiresAt: Date.now() + 600_000 });
        assert.match(res.text, /event: notification/);
        assert.equal(desktop.length, 1);
        assert.equal(desktop[0].id, 1);
        assert.equal(desktop[0].notice.id, 2);
        assert.equal(res.headers['X-Accel-Buffering'], 'no');
    } finally { res.destroy(); }
});

test('notification storage failures are contained instead of failing power actions', async () => {
    let logged = false;
    const service = createNotificationService({ database: { create: async () => { throw new Error('DB unavailable'); } }, agents: {}, logger: { error() { logged = true; } } });
    assert.equal(await service.publish({ instanceId: 1, title: 'Test', message: 'Test', type: 'test' }), null);
    assert.equal(logged, true);
});
