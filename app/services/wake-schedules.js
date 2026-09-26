import db from '../utils/db.js';
import wake from '../utils/wake.js';
import { validateSchedule } from './shutdown-schedules.js';

const isActive = value => Buffer.isBuffer(value) ? value[0] === 1 : Boolean(value);

export function publicWakeSchedule(row) {
    return {
        enabled: isActive(row.enabled), time: row.time_of_day, timezone: row.timezone,
        last_run_at: row.last_run_at, last_result: row.last_result
    };
}

export function registerWakeScheduleRoutes(app, database, onChange = async () => {}) {
    app.put('/instances/:instance/wake-schedule', async (req, res) => {
        const error = validateSchedule({ ...req.body, warning_minutes: 0 });
        if (error) return res.status(400).json({ error });
        const instance = await database.find('instance', req.params.instance);
        if (!instance) return res.status(404).json({ error: 'Machine no longer exists.' });
        if (req.body.enabled) {
            if (!isActive(instance.active)) return res.status(409).json({ error: 'Enable wake requests for this machine first.' });
            const { results } = await database.query('SELECT address FROM instance_mac WHERE instance_id = ? LIMIT 1', [instance.id]);
            if (!results.length) return res.status(409).json({ error: 'Add a MAC address before enabling a wake schedule.' });
        }
        const { enabled, time, timezone } = req.body;
        await database.query(
            'INSERT INTO wake_schedule (instance_id, enabled, time_of_day, timezone) VALUES (?, ?, ?, ?) ON DUPLICATE KEY UPDATE enabled = VALUES(enabled), time_of_day = VALUES(time_of_day), timezone = VALUES(timezone)',
            [instance.id, enabled, time, timezone]
        );
        await onChange(instance.id, req.body);
        res.sendStatus(204);
    });
}

export async function dispatchScheduledWake(instanceId, { database = db, sendWake = wake } = {}) {
    const instance = await database.find('instance', instanceId);
    if (!instance || !isActive(instance.active)) return 'Skipped: wake requests are paused';
    const { results: macs } = await database.query('SELECT address FROM instance_mac WHERE instance_id = ?', [instanceId]);
    if (!macs.length) return 'Skipped: no MAC address configured';
    const results = await Promise.allSettled(macs.map(mac => sendWake(mac.address)));
    const sent = results.filter(result => result.status === 'fulfilled').length;
    if (sent) await database.update('instance', instanceId, { last_wake_request: new Date() });
    const failed = results.length - sent;
    return `Wake packets sent to ${sent} MAC address${sent === 1 ? '' : 'es'}${failed ? `; ${failed} failed` : ''}.`;
}
