import test from 'node:test';
import assert from 'node:assert/strict';
import { createShutdownScheduler, localClock, validateSchedule, warningOccurrence } from '../app/services/shutdown-schedules.js';

test('schedule input validates times, timezones, and enabled flag', () => {
    assert.equal(validateSchedule({ enabled: true, time: '00:00', timezone: 'America/Los_Angeles' }), null);
    for (const time of ['24:00', '12:60', '1:00', null]) assert.ok(validateSchedule({ enabled: true, time, timezone: 'UTC' }));
    assert.ok(validateSchedule({ enabled: true, time: '00:00', timezone: 'Not/AZone' }));
    assert.ok(validateSchedule({ enabled: 'true', time: '00:00', timezone: 'UTC' }));
});

test('midnight follows the configured timezone including daylight saving', () => {
    assert.deepEqual(localClock(new Date('2026-09-25T07:00:00Z'), 'America/Los_Angeles'), { date: '2026-09-25', time: '00:00' });
    assert.deepEqual(localClock(new Date('2026-12-25T08:00:00Z'), 'America/Los_Angeles'), { date: '2026-12-25', time: '00:00' });
});

function fixture({ time = '00:00', timezone = 'America/Los_Angeles', instant = '2026-09-25T07:00:00Z' } = {}) {
    const row = { instance_id: 1, enabled: true, time_of_day: time, timezone, last_run_date: null };
    let clock = new Date(instant);
    let calls = 0;
    const db = { query: async (sql, args) => {
        if (sql.startsWith('SELECT')) return { results: row.enabled ? [{ ...row }] : [] };
        if (sql.includes('SET last_warning_date')) {
            if (!row.enabled || row.last_warning_date === args[0] || row.last_run_date === args[0]) return { results: { affectedRows: 0 } };
            row.last_warning_date = args[0];
            return { results: { affectedRows: 1 } };
        }
        if (sql.includes('SET last_run_date')) {
            if (!row.enabled || row.last_run_date === args[0]) return { results: { affectedRows: 0 } };
            row.last_run_date = args[0];
            row.last_run_at = args[1];
            return { results: { affectedRows: 1 } };
        }
        row.last_result = args[0];
        return { results: { affectedRows: 1 } };
    } };
    const options = { db, now: () => clock, dispatch: async () => { calls++; return 'Shutdown sent'; } };
    return { row, options, calls: () => calls, at: date => { clock = new Date(date); } };
}

test('one shutdown per local day survives scheduler restart and skips missed times', async () => {
    const f = fixture();
    await createShutdownScheduler(f.options).tick();
    await createShutdownScheduler(f.options).tick();
    assert.equal(f.calls(), 1);
    assert.equal(f.row.last_result, 'Shutdown sent');
    f.at('2026-09-26T07:01:00Z');
    await createShutdownScheduler(f.options).tick();
    assert.equal(f.calls(), 1, 'do not catch up missed shutdowns');
    f.at('2026-09-27T07:00:00Z');
    await createShutdownScheduler(f.options).tick();
    assert.equal(f.calls(), 2);
    f.row.enabled = false;
    f.at('2026-09-28T07:00:00Z');
    await createShutdownScheduler(f.options).tick();
    assert.equal(f.calls(), 2);
});

test('fall-back repeated hour runs once; spring-forward missing time is skipped', async () => {
    const f = fixture({ time: '01:30', instant: '2026-11-01T08:30:00Z' });
    await createShutdownScheduler(f.options).tick();
    f.at('2026-11-01T09:30:00Z');
    await createShutdownScheduler(f.options).tick();
    assert.equal(f.calls(), 1);
    const spring = fixture({ time: '02:30', instant: '2026-03-08T09:59:00Z' });
    await createShutdownScheduler(spring.options).tick();
    spring.at('2026-03-08T10:00:00Z');
    await createShutdownScheduler(spring.options).tick();
    assert.equal(spring.calls(), 0);
});

test('concurrent schedulers atomically claim once and record dispatch failures', async () => {
    const f = fixture();
    f.options.dispatch = async () => { throw new Error('Unreachable'); };
    await Promise.all([createShutdownScheduler(f.options).tick(), createShutdownScheduler(f.options).tick()]);
    assert.equal(f.row.last_result, 'Failed: Unreachable');
    let retried = false;
    f.options.dispatch = async () => { retried = true; };
    await createShutdownScheduler(f.options).tick();
    assert.equal(retried, false);
});


test('warning lead crosses midnight, is configurable, and can be disabled', () => {
    const schedule = { time_of_day: '00:00', timezone: 'America/Los_Angeles', warning_minutes: 10 };
    assert.equal(warningOccurrence(schedule, new Date('2026-09-25T06:50:15Z')).dueAt.toISOString(), '2026-09-25T07:00:00.000Z');
    assert.equal(warningOccurrence(schedule, new Date('2026-09-25T06:51:00Z')), null);
    assert.equal(warningOccurrence({ ...schedule, warning_minutes: 30 }, new Date('2026-09-25T06:30:00Z')).minutes, 30);
    assert.equal(warningOccurrence({ ...schedule, warning_minutes: 0 }, new Date('2026-09-25T06:50:00Z')), null);
    for (const warning_minutes of [-1, 121, 1.5, '10', null]) {
        assert.ok(validateSchedule({ enabled: true, time: '00:00', timezone: 'UTC', warning_minutes }));
    }
});

test('reminders claim once across concurrent ticks and restarts without dispatching early', async () => {
    const f = fixture({ instant: '2026-09-25T06:50:00Z' });
    const notices = [];
    f.options.warn = async (id, warning) => { notices.push({ id, ...warning }); };
    await Promise.all([createShutdownScheduler(f.options).tick(), createShutdownScheduler(f.options).tick()]);
    await createShutdownScheduler(f.options).tick();
    assert.equal(notices.length, 1);
    assert.equal(notices[0].minutes, 10);
    assert.equal(f.calls(), 0);
    f.at('2026-09-25T07:00:00Z');
    await createShutdownScheduler(f.options).tick();
    assert.equal(f.calls(), 1);
});

test('warnings honor DST jumps and never announce a second fall-back occurrence', () => {
    const schedule = { time_of_day: '01:30', timezone: 'America/Los_Angeles', warning_minutes: 120 };
    assert.ok(warningOccurrence(schedule, new Date('2026-11-01T06:30:00Z')));
    assert.equal(warningOccurrence(schedule, new Date('2026-11-01T07:30:00Z')), null);
    assert.equal(warningOccurrence({ ...schedule, time_of_day: '02:30', warning_minutes: 10 }, new Date('2026-03-08T10:20:00Z')), null);
});
