import db from '../utils/db.js';
import { createShutdownStrategy } from '../strategies/shutdown.js';

export async function dispatchScheduledShutdown(instanceId) {
    const { results: strategies } = await db.query('SELECT * FROM shutdown_strategy WHERE instance_id = ?', [instanceId]);
    if (!strategies.length) return 'Skipped: no shutdown strategy configured';
    const results = await Promise.allSettled(strategies.map(strategy => createShutdownStrategy(strategy).execute({ scheduled: true })));
    return results.map((result, index) => {
        const label = strategies[index].type === 'ssh' ? 'SSH' : 'Remote agent';
        if (result.status === 'rejected') return `${label}: failed (${result.reason.message})`;
        return result.value.status === 'skipped' ? `${label}: skipped (offline)` : `${label}: shutdown sent`;
    }).join('; ');
}
