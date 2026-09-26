import test from 'node:test';
import assert from 'node:assert/strict';
import { createNotificationService } from '../app/services/notifications.js';

test('machine notifications are recorded and sent through Pushover', async () => {
    const history = [];
    const phone = [];
    const service = createNotificationService({
        database: {
            create: async (_table, row) => { const saved = { ...row, id: history.length + 1 }; history.push(saved); return saved; },
            find: async () => ({ name: 'Machine' }),
            query: async sql => sql.startsWith('SELECT enabled FROM notification_preference') ? { results: [] } : { results: history }
        },
        sendPhone: async notice => phone.push(notice)
    });
    await service.forMachine(1, { type: 'wake_requested', title: 'Start requested', message: 'Wake packets sent.' });
    await service.forMachine(1, { type: 'shutdown_warning', title: 'Shutdown soon', message: 'Save your work.', expiresAt: Date.now() + 600_000 });
    assert.equal(phone.length, 2);
    assert.equal(phone[0].title, 'Machine · Start requested');
    assert.equal(phone[1].id, 2);
    assert.equal(phone[1].type, 'shutdown_warning');
});

test('notification storage failures are contained instead of failing power actions', async () => {
    let logged = false;
    const service = createNotificationService({ database: { create: async () => { throw new Error('DB unavailable'); } }, logger: { error() { logged = true; } } });
    assert.equal(await service.publish({ instanceId: 1, title: 'Test', message: 'Test', type: 'test' }), null);
    assert.equal(logged, true);
});
