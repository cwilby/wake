const enabled = value => Buffer.isBuffer(value) ? value[0] === 1 : Boolean(value);

export function publicSchedule(row) {
    if (!row) return null;
    return {
        enabled: enabled(row.enabled), time: row.time_of_day, timezone: row.timezone,
        last_run_at: row.last_run_at, last_result: row.last_result
    };
}

export function validateSchedule(value) {
    if (typeof value?.enabled !== 'boolean') return 'Choose whether the schedule is enabled.';
    if (typeof value.time !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(value.time)) return 'Choose a valid shutdown time.';
    if (typeof value.timezone !== 'string' || !value.timezone || value.timezone.length > 100) return 'Choose a valid timezone.';
    try {
        new Intl.DateTimeFormat('en', { timeZone: value.timezone });
    } catch {
        return 'Choose a valid timezone.';
    }
    return null;
}

export function localClock(now, timezone) {
    const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
        timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
    }).formatToParts(now).map(part => [part.type, part.value]));
    return { date: `${parts.year}-${parts.month}-${parts.day}`, time: `${parts.hour}:${parts.minute}` };
}

export function registerScheduleRoutes(app, db) {
    app.put('/instances/:instance/shutdown-schedule', async (req, res) => {
        const error = validateSchedule(req.body);
        if (error) return res.status(400).json({ error });
        const instance = await db.find('instance', req.params.instance);
        if (!instance) return res.status(404).json({ error: 'Machine no longer exists.' });
        if (req.body.enabled) {
            const { results } = await db.query('SELECT id FROM shutdown_strategy WHERE instance_id = ? LIMIT 1', [instance.id]);
            if (!results.length) return res.status(409).json({ error: 'Add a shutdown strategy before enabling a schedule.' });
        }
        const { enabled: active, time, timezone } = req.body;
        await db.query(
            'INSERT INTO shutdown_schedule (instance_id, enabled, time_of_day, timezone) VALUES (?, ?, ?, ?) ON DUPLICATE KEY UPDATE enabled = VALUES(enabled), time_of_day = VALUES(time_of_day), timezone = VALUES(timezone)',
            [instance.id, active, time, timezone]
        );
        res.sendStatus(204);
    });
}

export function createShutdownScheduler({ db, dispatch, now = () => new Date(), logger = console, intervalMs = 15_000 }) {
    let running = false;
    let timer;
    async function tick() {
        if (running) return;
        running = true;
        try {
            const { results: schedules } = await db.query('SELECT * FROM shutdown_schedule WHERE enabled = 1');
            await Promise.all(schedules.map(async schedule => {
                try {
                    const current = now();
                    const local = localClock(current, schedule.timezone);
                    // Only the current minute is eligible: no delayed shutdown after server downtime.
                    if (local.time !== schedule.time_of_day || local.date === schedule.last_run_date) return;
                    const { results } = await db.query(
                        'UPDATE shutdown_schedule SET last_run_date = ?, last_run_at = ?, last_result = ? WHERE instance_id = ? AND enabled = 1 AND time_of_day = ? AND timezone = ? AND (last_run_date IS NULL OR last_run_date <> ?)',
                        [local.date, current.toISOString(), 'Dispatching shutdown', schedule.instance_id, schedule.time_of_day, schedule.timezone, local.date]
                    );
                    if (!results.affectedRows) return;
                    // Persist the claim before dispatch, including across restarts and DST's repeated hour.
                    let result;
                    try {
                        result = await dispatch(schedule.instance_id);
                    } catch (error) {
                        result = `Failed: ${error.message}`;
                    }
                    await db.query('UPDATE shutdown_schedule SET last_result = ? WHERE instance_id = ? AND last_run_at = ?',
                        [result, schedule.instance_id, current.toISOString()]);
                } catch (error) {
                    logger.error(`Shutdown schedule ${schedule.instance_id} failed: ${error.message}`);
                }
            }));
        } catch (error) {
            logger.error(`Shutdown scheduler failed: ${error.message}`);
        } finally {
            running = false;
        }
    }
    return {
        tick,
        start() {
            if (timer) return;
            void tick();
            timer = setInterval(tick, intervalMs);
            timer.unref();
        },
        stop() { clearInterval(timer); timer = null; }
    };
}
