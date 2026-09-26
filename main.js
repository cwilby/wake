import 'dotenv/config';
import database from './database/index.js';
import app from './app/index.js';
import notifications from './app/services/notifications.js';
import db from './app/utils/db.js';
import { createShutdownScheduler, createWakeScheduler } from './app/services/shutdown-schedules.js';
import { dispatchScheduledShutdown } from './app/services/scheduled-shutdown.js';
import { dispatchScheduledWake } from './app/services/wake-schedules.js';
import writeLogo from './app/utils/writeLogo.js';

(async () => {
    writeLogo();
    
    await database.runMigrations();
    createShutdownScheduler({
        db, dispatch: dispatchScheduledShutdown,
        warn: (instanceId, { minutes, dueAt, time, timezone }) => notifications.forMachine(instanceId, {
            type: 'shutdown_warning', title: 'Scheduled shutdown soon',
            message: `Scheduled to shut down in ${minutes} minute${minutes === 1 ? '' : 's'}, at ${time} (${timezone}). Save your work.`,
            expiresAt: dueAt.getTime(), phone: true
        }),
        onResult: (instanceId, result) => notifications.forMachine(instanceId, {
            type: 'scheduled_shutdown', title: 'Scheduled shutdown result', message: result
        })
    }).start();

    createWakeScheduler({
        db, dispatch: dispatchScheduledWake,
        onResult: (instanceId, result) => notifications.forMachine(instanceId, {
            type: 'scheduled_wake', title: 'Scheduled wake result', message: result
        })
    }).start();

    const port = process.env.WAKE_HTTP_PORT || 3000;
    app.listen(port, () => console.log(`Web server is running on port ${port}`));
})();
