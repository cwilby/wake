export const notificationTypes = [
    { type: 'shutdown_warning', label: 'Upcoming shutdown warnings', description: 'A configurable number of minutes before a scheduled shutdown.' },
    { type: 'wake_requested', label: 'Start requests', description: 'When a start action is sent from Wake.' },
    { type: 'shutdown_requested', label: 'Manual shutdown requests', description: 'When you send a shutdown action from Wake.' },
    { type: 'shutdown_failed', label: 'Shutdown failures', description: 'When Wake cannot send a shutdown command.' },
    { type: 'schedule_changed', label: 'Shutdown schedule changes', description: 'Schedule edits, skipped shutdowns, and one hour delays.' },
    { type: 'wake_schedule_changed', label: 'Wake schedule changes', description: 'When a daily wake schedule is edited or disabled.' },
    { type: 'scheduled_shutdown', label: 'Scheduled shutdown results', description: 'Whether a scheduled shutdown was sent or skipped.' },
    { type: 'scheduled_wake', label: 'Scheduled start results', description: 'Whether a scheduled start was sent or skipped.' }
];

const byType = new Map(notificationTypes.map(item => [item.type, item]));
const asBoolean = value => Buffer.isBuffer(value) ? value[0] === 1 : Boolean(value);

export async function isNotificationEnabled(database, type) {
    if (!byType.has(type)) return true;
    const { results } = await database.query('SELECT enabled FROM notification_preference WHERE type = ? LIMIT 1', [type]);
    return results.length ? asBoolean(results[0].enabled) : true;
}

export function registerNotificationPreferenceRoutes(app, database) {
    app.get('/notification-preferences', async (_req, res) => {
        const { results } = await database.query('SELECT type, enabled FROM notification_preference');
        const saved = new Map(results.map(row => [row.type, asBoolean(row.enabled)]));
        res.json(notificationTypes.map(option => ({ ...option, enabled: saved.get(option.type) ?? true })));
    });
    app.put('/notification-preferences/:type', async (req, res) => {
        if (!byType.has(req.params.type)) return res.status(404).json({ error: 'Unknown notification type.' });
        if (typeof req.body?.enabled !== 'boolean') return res.status(400).json({ error: 'Choose whether this notification is enabled.' });
        await database.query('INSERT INTO notification_preference (type, enabled) VALUES (?, ?) ON DUPLICATE KEY UPDATE enabled = VALUES(enabled)',
            [req.params.type, req.body.enabled]);
        res.sendStatus(204);
    });
}
