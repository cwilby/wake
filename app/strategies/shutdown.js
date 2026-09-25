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

    async execute() {
        // Coalesce repeated clicks while an earlier shutdown is awaiting acknowledgement.
        await db.query(
            'UPDATE shutdown_strategy SET shutdown_request_id = COALESCE(shutdown_request_id, ?), shutdown_requested_at = COALESCE(shutdown_requested_at, ?) WHERE id = ?',
            [randomUUID(), new Date(), this.configuration.id]
        );
        const current = await db.find('shutdown_strategy', this.configuration.id);
        if (!current) throw new Error('Shutdown strategy no longer exists.');
        const requestId = current.shutdown_request_id;
        agentConnections.send(this.configuration.id, requestId);
        return { id: this.configuration.id, type: 'remote-agent', status: 'queued', requestId };
    }
}

export function createShutdownStrategy(configuration) {
    if (configuration.type === 'ssh') return new SshShutdownStrategy(configuration);
    if (configuration.type === 'remote-agent') return new RemoteAgentShutdownStrategy(configuration);
    throw new Error(`Unsupported shutdown strategy: ${configuration.type}`);
}
