import db from '../utils/db.js';
import { sendPhoneNotification } from './pushover.js';

export function createNotificationService({ database, sendPhone = sendPhoneNotification, logger = console }) {
    const viewers = new Set();
    const write = (res, event, data) => {
        if (res.destroyed || res.writableEnded) return;
        if (!res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)) res.destroy();
    };
    return {
        async publish({ instanceId, type, title, message, expiresAt = null, phone = false }) {
            try {
                const notification = await database.create('notification', {
                    instance_id: instanceId, type, title, message,
                    created_at: new Date().toISOString(), expires_at: expiresAt
                });
                for (const res of viewers) write(res, 'notification', notification);
                if (phone) {
                    try { await sendPhone(notification); }
                    catch (error) {
                        logger.error(`Phone warning failed: ${error.message}`);
                        await this.publish({ instanceId, type: 'phone_warning_failed', title: 'Phone warning not delivered',
                            message: 'Check Pushover settings and server connectivity. The scheduled shutdown is still active.' });
                    }
                }
                return notification;
            } catch (error) {
                // Notification failures must never prevent an authorized power action.
                logger.error(`Notification failed: ${error.message}`);
                return null;
            }
        },
        async forMachine(instanceId, event) {
            try {
                const machine = await database.find('instance', instanceId);
                if (event.type === 'schedule_changed') {
                    await database.query('UPDATE notification SET expires_at = ? WHERE instance_id = ? AND type = ? AND expires_at > ?',
                        [Date.now(), Number(instanceId), 'shutdown_warning', Date.now()]);
                }
                return await this.publish({ ...event, instanceId: Number(instanceId),
                    title: `${machine?.name || 'Machine'} · ${event.title}`.slice(0, 255) });
            } catch (error) {
                logger.error(`Notification failed: ${error.message}`);
                return null;
            }
        },
        register(app) {
            app.get('/notifications/events', async (_req, res) => {
                res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', 'X-Accel-Buffering': 'no' });
                res.socket?.setTimeout(0);
                res.flushHeaders();
                viewers.add(res);
                const heartbeat = setInterval(() => {
                    if (!res.write(': heartbeat\n\n')) res.destroy();
                }, 25_000);
                heartbeat.unref();
                res.on('close', () => { clearInterval(heartbeat); viewers.delete(res); });
                try {
                    const { results } = await database.query('SELECT * FROM notification ORDER BY id DESC LIMIT 50');
                    write(res, 'snapshot', results);
                } catch (error) {
                    logger.error(`Notification history failed: ${error.message}`);
                    res.destroy();
                }
            });
        }
    };
}

export default createNotificationService({ database: db });
