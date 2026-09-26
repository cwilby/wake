const enabled = value => Buffer.isBuffer(value) ? value[0] === 1 : Boolean(value);

export function publicSchedule(row) {
    if (!row) return null;
    return {
        enabled: enabled(row.enabled), warning_minutes: row.warning_minutes ?? 10, time: row.time_of_day, timezone: row.timezone,
        last_run_at: row.last_run_at, last_result: row.last_result,
        next_run: nextShutdown(row),
        override: row.override_action ? { action: row.override_action, date: row.override_date, due_at: row.override_due_at } : null
    };
}

export function validateSchedule(value) {
    if (value?.warning_minutes !== undefined && (!Number.isInteger(value.warning_minutes) || value.warning_minutes < 0 || value.warning_minutes > 120)) return 'Warning must be between 0 and 120 minutes.';
    if (typeof value?.enabled !== 'boolean') return 'Choose whether the schedule is enabled.';
    if (typeof value.time !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(value.time)) return 'Choose a valid schedule time.';
    if (typeof value.timezone !== 'string' || !value.timezone || value.timezone.length > 100) return 'Choose a valid timezone.';
    try {
        new Intl.DateTimeFormat('en', { timeZone: value.timezone });
    } catch {
        return 'Choose a valid timezone.';
    }
    return null;
}

const clocks = new Map();

export function localClock(now, timezone) {
    if (!clocks.has(timezone)) clocks.set(timezone, new Intl.DateTimeFormat('en-CA', {
        timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
    }));
    const parts = Object.fromEntries(clocks.get(timezone).formatToParts(now).map(part => [part.type, part.value]));
    return { date: `${parts.year}-${parts.month}-${parts.day}`, time: `${parts.hour}:${parts.minute}` };
}

// Resolve one occurrence without moving the recurring schedule.
export function shutdownOccurrence(schedule, instant) {
    const minute = Math.floor(instant.getTime() / 60_000) * 60_000;
    if (schedule.override_action === 'delay' && Number(schedule.override_due_at) === minute && schedule.override_date !== schedule.last_run_date) {
        return { date: schedule.override_date, due_at: minute, delayed: true };
    }
    const local = localClock(instant, schedule.timezone);
    if (local.time !== schedule.time_of_day || local.date === schedule.last_run_date) return null;
    if (schedule.override_date === local.date && schedule.override_action) return null;
    return { date: local.date, due_at: minute, delayed: false };
}

export function nextShutdown(schedule, now = new Date()) {
    if (!enabled(schedule.enabled)) return null;
    const first = Math.floor(now.getTime() / 60_000) * 60_000 + 60_000;
    // Covers skipped days and DST gaps. Use actual instants, never the server's timezone.
    for (let minute = first; minute <= first + 72 * 60 * 60_000; minute += 60_000) {
        const occurrence = shutdownOccurrence(schedule, new Date(minute));
        if (occurrence) return occurrence;
    }
    return null;
}

export function warningOccurrence(schedule, current) {
    const minutes = schedule.warning_minutes ?? 10;
    if (minutes <= 0) return null;
    const minute = Math.floor(current.getTime() / 60_000) * 60_000;
    const dueAt = new Date(minute + minutes * 60_000);
    const upcoming = shutdownOccurrence(schedule, dueAt);
    if (!upcoming || upcoming.date === schedule.last_warning_date) return null;
    for (let offset = 0; offset < minutes; offset++) {
        const earlier = shutdownOccurrence(schedule, new Date(minute + offset * 60_000));
        if (earlier?.date === upcoming.date) return null;
    }
    return { date: upcoming.date, dueAt, minutes };
}

export async function changeNextShutdown(db, instanceId, body, now = new Date()) {
    if (!['skip', 'delay'].includes(body?.action) || !Number.isSafeInteger(body?.expected_due_at)) {
        return { status: 400, error: 'Choose skip or delay for the displayed shutdown.' };
    }
    let outcome;
    await db.usingTransaction(async tx => {
        const { results } = await tx.query('SELECT * FROM shutdown_schedule WHERE instance_id = ? FOR UPDATE', [instanceId]);
        const schedule = results[0];
        if (!schedule || !enabled(schedule.enabled)) { outcome = { status: 409, error: 'There is no enabled shutdown schedule.' }; return; }
        const upcoming = nextShutdown(schedule, now);
        if (!upcoming || upcoming.due_at !== body.expected_due_at) {
            outcome = { status: 409, error: 'The shutdown has already started or changed. Refresh and try again.' }; return;
        }
        const dueAt = body.action === 'delay' ? upcoming.due_at + 60 * 60_000 : null;
        if (dueAt) {
            const following = nextShutdown({ ...schedule, override_action: 'skip', override_date: upcoming.date }, now);
            if (following && dueAt >= following.due_at) {
                outcome = { status: 409, error: 'This delay would overlap the following daily shutdown.' }; return;
            }
        }
        await tx.query('UPDATE shutdown_schedule SET override_date = ?, override_action = ?, override_due_at = ?, last_warning_date = NULL, revision = revision + 1 WHERE instance_id = ?',
            [upcoming.date, body.action, dueAt, instanceId]);
        outcome = { status: 200, action: body.action, date: upcoming.date, due_at: dueAt };
    });
    return outcome;
}

export function registerScheduleRoutes(app, db, onChange = async () => {}, onOverride = async () => {}) {
    app.put('/instances/:instance/shutdown-schedule', async (req, res) => {
        const error = validateSchedule(req.body);
        if (error) return res.status(400).json({ error });
        const instance = await db.find('instance', req.params.instance);
        if (!instance) return res.status(404).json({ error: 'Machine no longer exists.' });
        if (req.body.enabled) {
            const { results } = await db.query('SELECT id FROM shutdown_strategy WHERE instance_id = ? LIMIT 1', [instance.id]);
            if (!results.length) return res.status(409).json({ error: 'Add a shutdown strategy before enabling a schedule.' });
        }
        const { enabled: active, time, timezone, warning_minutes: warningMinutes = 10 } = req.body;
        await db.query(
            'INSERT INTO shutdown_schedule (instance_id, enabled, time_of_day, timezone, warning_minutes) VALUES (?, ?, ?, ?, ?) ON DUPLICATE KEY UPDATE enabled = VALUES(enabled), time_of_day = VALUES(time_of_day), timezone = VALUES(timezone), warning_minutes = VALUES(warning_minutes), override_date = NULL, override_action = NULL, override_due_at = NULL, last_warning_date = NULL, revision = revision + 1',
            [instance.id, active, time, timezone, warningMinutes]
        );
        await onChange(instance.id, req.body);
        res.sendStatus(204);
    });
    app.post('/instances/:instance/shutdown-schedule/override', async (req, res) => {
        const outcome = await changeNextShutdown(db, Number(req.params.instance), req.body);
        if (outcome.error) return res.status(outcome.status).json({ error: outcome.error });
        await onOverride(Number(req.params.instance), outcome);
        res.json(outcome);
    });
}

function createDailyScheduler({ db, dispatch, warn = async () => {}, onResult = async () => {}, now = () => new Date(), logger = console, intervalMs = 15_000 }, kind) {
    const table = kind === 'wake' ? 'wake_schedule' : 'shutdown_schedule';
    let running = false;
    let timer;
    async function tick() {
        if (running) return;
        running = true;
        try {
            const { results: schedules } = await db.query(`SELECT * FROM ${table} WHERE enabled = 1`);
            await Promise.all(schedules.map(async schedule => {
                try {
                    const current = now();
                    const local = localClock(current, schedule.timezone);
                    const warning = kind === 'shutdown' ? warningOccurrence(schedule, current) : null;
                    if (warning) {
                        const { date, dueAt, minutes } = warning;
                        const { results: claim } = await db.query(
                            'UPDATE shutdown_schedule SET last_warning_date = ? WHERE instance_id = ? AND enabled = 1 AND time_of_day = ? AND timezone = ? AND warning_minutes = ? AND (last_warning_date IS NULL OR last_warning_date <> ?) AND (last_run_date IS NULL OR last_run_date <> ?) AND revision = ?',
                            [date, schedule.instance_id, schedule.time_of_day, schedule.timezone, minutes, date, date, schedule.revision ?? 0]
                        );
                        if (claim.affectedRows) {
                            try { await warn(schedule.instance_id, { minutes, dueAt, time: localClock(dueAt, schedule.timezone).time, timezone: schedule.timezone }); }
                            catch (error) { logger.error(`Shutdown warning failed: ${error.message}`); }
                        }
                    }
                    // Only the current minute is eligible: no delayed shutdown after server downtime.
                    const occurrence = kind === 'shutdown' ? shutdownOccurrence(schedule, current) :
                        (local.time === schedule.time_of_day && local.date !== schedule.last_run_date ? { date: local.date } : null);
                    if (!occurrence) return;
                    const runDate = occurrence.date;
                    const { results } = await db.query(
                        `UPDATE ${table} SET last_run_date = ?, last_run_at = ?, last_result = ? WHERE instance_id = ? AND enabled = 1 AND time_of_day = ? AND timezone = ? AND (last_run_date IS NULL OR last_run_date <> ?)${kind === 'shutdown' ? ' AND revision = ?' : ''}`,
                        [runDate, current.toISOString(), `Dispatching ${kind}`, schedule.instance_id, schedule.time_of_day, schedule.timezone, runDate, ...(kind === 'shutdown' ? [schedule.revision ?? 0] : [])]
                    );
                    if (!results.affectedRows) return;
                    // Persist the claim before dispatch, including across restarts and DST's repeated hour.
                    let result;
                    try {
                        result = await dispatch(schedule.instance_id);
                    } catch (error) {
                        result = `Failed: ${error.message}`;
                    }
                    await db.query(`UPDATE ${table} SET last_result = ? WHERE instance_id = ? AND last_run_at = ?`,
                        [result, schedule.instance_id, current.toISOString()]);
                    await onResult(schedule.instance_id, result);
                } catch (error) {
                    logger.error(`${kind} schedule ${schedule.instance_id} failed: ${error.message}`);
                }
            }));
        } catch (error) {
            logger.error(`${kind} scheduler failed: ${error.message}`);
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


export function createShutdownScheduler(options) {
    return createDailyScheduler(options, 'shutdown');
}

export function createWakeScheduler(options) {
    return createDailyScheduler(options, 'wake');
}
