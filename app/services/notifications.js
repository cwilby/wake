import db from '../utils/db.js';
import { sendPhoneNotification } from './pushover.js';

export function createNotificationService({ database, sendPhone = sendPhoneNotification, logger = console }) {
    return {
        async publish({ instanceId, type, title, message, expiresAt = null, phone = false }) {
            try {
                const notification = await database.create('notification', {
                    instance_id: instanceId, type, title, message,
                    created_at: new Date().toISOString(), expires_at: expiresAt
                });
                if (phone) {
                    try { await sendPhone(notification); }
                    catch (error) {
                        logger.error(`Pushover notification failed: ${error.message}`);
                        await this.publish({ instanceId, type: 'pushover_delivery_failed', title: 'Pushover notification not delivered',
                            message: 'Check Pushover settings and server connectivity.' });
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
                    title: `${machine?.name || 'Machine'} · ${event.title}`.slice(0, 255), phone: event.phone ?? true });
            } catch (error) {
                logger.error(`Notification failed: ${error.message}`);
                return null;
            }
        }
    };
}

export default createNotificationService({ database: db });
