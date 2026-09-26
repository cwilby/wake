import test from 'node:test';
import assert from 'node:assert/strict';
import { isNotificationEnabled, registerNotificationPreferenceRoutes } from '../app/services/notification-preferences.js';

test('notification choices default on, persist explicit overrides, and gate phone delivery', async () => {
    const saved = new Map();
    const database = {
        async query(sql, args = []) {
            if (sql.startsWith('SELECT enabled')) return { results: saved.has(args[0]) ? [{ enabled: saved.get(args[0]) }] : [] };
            if (sql.startsWith('SELECT type')) return { results: [...saved].map(([type, enabled]) => ({ type, enabled })) };
            saved.set(args[0], args[1]);
            return { results: { affectedRows: 1 } };
        }
    };
    assert.equal(await isNotificationEnabled(database, 'wake_requested'), true);
    assert.equal(await isNotificationEnabled(database, 'unknown_type'), true);

    let getRoute;
    let putRoute;
    const app = {
        get(path, route) { assert.equal(path, '/notification-preferences'); getRoute = route; },
        put(path, route) { assert.equal(path, '/notification-preferences/:type'); putRoute = route; }
    };
    registerNotificationPreferenceRoutes(app, database);
    const snapshot = { json(value) { this.body = value; } };
    await getRoute({}, snapshot);
    assert.equal(snapshot.body.find(item => item.type === 'wake_requested').enabled, true);

    let status;
    const response = { status(value) { status = value; return this; }, json(value) { this.body = value; return this; }, sendStatus(value) { status = value; } };
    await putRoute({ params: { type: 'wake_requested' }, body: { enabled: false } }, response);
    assert.equal(status, 204);
    assert.equal(await isNotificationEnabled(database, 'wake_requested'), false);
    await putRoute({ params: { type: 'unknown_type' }, body: { enabled: true } }, response);
    assert.equal(status, 404);
});
