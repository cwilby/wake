import { randomUUID } from 'node:crypto';
import db from '../utils/db.js';
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
        const requestId = randomUUID();
        await db.update('shutdown_strategy', this.configuration.id, {
            shutdown_request_id: requestId,
            shutdown_requested_at: new Date()
        });
        return { id: this.configuration.id, type: 'remote-agent', status: 'queued', requestId };
    }
}

export function createShutdownStrategy(configuration) {
    if (configuration.type === 'ssh') return new SshShutdownStrategy(configuration);
    if (configuration.type === 'remote-agent') return new RemoteAgentShutdownStrategy(configuration);
    throw new Error(`Unsupported shutdown strategy: ${configuration.type}`);
}
