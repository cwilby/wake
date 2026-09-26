import { randomUUID } from 'node:crypto';
import db from '../utils/db.js';
import agentConnections from '../utils/agent-connections.js';
import { shutdownOverSsh } from '../utils/shutdown.js';

export class SshShutdownStrategy {
    constructor(configuration) {
        this.configuration = configuration;
    }

    async execute() {
        await shutdownOverSsh(this.configuration);
        return { id: this.configuration.id, type: 'ssh', status: 'sent' };
    }
}

export class RemoteAgentShutdownStrategy {
    constructor(configuration) {
        this.configuration = configuration;
    }

    async execute({ scheduled = false } = {}) {
        if (scheduled && !agentConnections.has(this.configuration.id)) {
            return { id: this.configuration.id, type: 'remote-agent', status: 'skipped' };
        }
        const requestId = randomUUID();
        const now = Date.now();
        await db.query(
            'UPDATE shutdown_strategy SET shutdown_request_id = NULL, shutdown_requested_at = NULL, shutdown_expires_at = NULL WHERE id = ? AND shutdown_expires_at <= ?',
            [this.configuration.id, now]
        );
        // Preserve a pending manual request; replace expired scheduled requests.
        // Assign expiry before request id, while the old pending state is still available.
        await db.query(
            `UPDATE shutdown_strategy SET
                shutdown_expires_at = IF(shutdown_request_id IS NULL, ?, shutdown_expires_at),
                shutdown_request_id = COALESCE(shutdown_request_id, ?),
                shutdown_requested_at = COALESCE(shutdown_requested_at, ?)
             WHERE id = ?`,
            [scheduled ? now + 60_000 : null, requestId, new Date(now), this.configuration.id]
        );
        const current = await db.find('shutdown_strategy', this.configuration.id);
        if (!current) throw new Error('Shutdown strategy no longer exists.');
        agentConnections.send(this.configuration.id, current.shutdown_request_id);
        return { id: this.configuration.id, type: 'remote-agent', status: 'queued', requestId: current.shutdown_request_id };
    }

}

export function createShutdownStrategy(configuration) {
    if (configuration.type === 'ssh') return new SshShutdownStrategy(configuration);
    if (configuration.type === 'remote-agent') return new RemoteAgentShutdownStrategy(configuration);
    throw new Error(`Unsupported shutdown strategy: ${configuration.type}`);
}
