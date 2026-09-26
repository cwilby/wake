import test from 'node:test';
import assert from 'node:assert/strict';
import { createWakeScheduler } from '../app/services/shutdown-schedules.js';
import { dispatchScheduledWake, registerWakeScheduleRoutes } from '../app/services/wake-schedules.js';

test('scheduled wake sends all MACs, records successful requests, and reports partial failure', async () => {
    const sent = [];
    let updated = false;
    const database = {
        find: async () => ({ active: Buffer.from([1]) }),
        query: async () => ({ results: [{ address: 'first' }, { address: 'second' }] }),
        update: async (_table, id, values) => { assert.equal(id, 1); assert.ok(values.last_wake_request instanceof Date); updated = true; }
    };
    const result = await dispatchScheduledWake(1, { database, sendWake: async address => { sent.push(address); if (address === 'second') throw new Error('Network unavailable'); } });
    assert.deepEqual(sent, ['first', 'second']);
    assert.equal(updated, true);
    assert.match(result, /1 MAC address; 1 failed/);
});

test('paused or unconfigured machines do not send packets', async () => {
    let active = Buffer.from([0]);
    const database = { find: async () => ({ active }), query: async () => ({ results: [] }) };
    const options = { database, sendWake: async () => assert.fail('Unexpected wake packet') };
    assert.match(await dispatchScheduledWake(1, options), /paused/);
    active = true;
    assert.match(await dispatchScheduledWake(1, options), /no MAC/);
});

test('wake API validates enabled state, MAC setup, and independent saved configuration', async () => {
    let handler;
    let active = false;
    let macs = [];
    const queries = [];
    const database = {
        find: async (_table, id) => Number(id) === 1 ? { id: 1, active } : null,
        query: async (sql, args) => { queries.push({ sql, args }); return { results: macs }; }
    };
    registerWakeScheduleRoutes({ put: (route, fn) => { assert.equal(route, '/instances/:instance/wake-schedule'); handler = fn; } }, database);
    async function save(body, id = 1) {
        const response = { code: 200, status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; }, sendStatus(code) { this.code = code; } };
        await handler({ params: { instance: String(id) }, body }, response);
        return response;
    }
    const config = { enabled: true, time: '08:00', timezone: 'America/Los_Angeles' };
    assert.equal((await save({ ...config, time: '25:00' })).code, 400);
    assert.equal((await save(config, 2)).code, 404);
    assert.equal((await save(config)).code, 409);
    active = true;
    assert.equal((await save(config)).code, 409);
    macs = [{ address: 'aa:bb:cc:dd:ee:ff' }];
    assert.equal((await save(config)).code, 204);
    assert.deepEqual(queries.at(-1).args, [1, true, '08:00', 'America/Los_Angeles']);
    assert.match(queries.at(-1).sql, /INSERT INTO wake_schedule/);
    active = false;
    assert.equal((await save({ ...config, enabled: false })).code, 204);
});

test('daily wake claims persist across restarts, never run shutdown warnings, and skip missed times', async () => {
    const row = { instance_id: 1, time_of_day: '08:00', timezone: 'America/Los_Angeles', last_run_date: null };
    let current = new Date('2026-09-25T15:00:00Z');
    let dispatches = 0;
    const database = { query: async (sql, args) => {
        assert.match(sql, /wake_schedule/);
        if (sql.startsWith('SELECT')) return { results: [{ ...row }] };
        if (sql.includes('SET last_run_date')) {
            if (row.last_run_date === args[0]) return { results: { affectedRows: 0 } };
            row.last_run_date = args[0];
        }
        return { results: { affectedRows: 1 } };
    } };
    const options = { db: database, now: () => current, dispatch: async () => { dispatches++; return 'Sent'; }, warn: async () => assert.fail('Wake must not send shutdown warnings') };
    await Promise.all([createWakeScheduler(options).tick(), createWakeScheduler(options).tick()]);
    await createWakeScheduler(options).tick();
    assert.equal(dispatches, 1);
    current = new Date('2026-09-26T15:01:00Z');
    await createWakeScheduler(options).tick();
    assert.equal(dispatches, 1);
    current = new Date('2026-09-27T15:00:00Z');
    await createWakeScheduler(options).tick();
    assert.equal(dispatches, 2);
});
