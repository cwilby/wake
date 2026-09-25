// One persistent event stream per strategy. Commands remain in MySQL until acknowledged.
export class AgentConnections {
    constructor({ heartbeatMs = 25_000 } = {}) {
        this.clients = new Map();
        this.heartbeatMs = heartbeatMs;
    }

    has(id) {
        return this.clients.has(Number(id));
    }

    connect(strategy, res) {
        const id = Number(strategy.id);
        this.disconnect(id);
        res.set({
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache, no-transform',
            'Connection': 'keep-alive',
            'X-Accel-Buffering': 'no'
        });
        res.socket?.setTimeout(0);
        res.socket?.setKeepAlive(true, 30_000);
        res.flushHeaders();
        const client = { res, instanceId: Number(strategy.instance_id), lastRequest: null };
        this.clients.set(id, client);
        const write = data => {
            if (res.destroyed || res.writableEnded) return;
            // A stalled reader must not accumulate an unbounded write buffer.
            if (!res.write(data)) res.destroy();
        };
        const heartbeat = setInterval(() => write(': heartbeat\n\n'), this.heartbeatMs);
        heartbeat.unref();
        res.on('close', () => {
            clearInterval(heartbeat);
            if (this.clients.get(id) === client) this.clients.delete(id);
        });
        write(': connected\n\n');
    }

    send(id, requestId) {
        const client = this.clients.get(Number(id));
        if (!client || !requestId || client.lastRequest === requestId) return;
        if (client.res.destroyed || client.res.writableEnded) return;
        client.lastRequest = requestId;
        if (!client.res.write(`data: ${JSON.stringify({ shutdown: true, request_id: requestId })}\n\n`)) {
            client.res.destroy();
        }
    }

    disconnect(id) {
        const client = this.clients.get(Number(id));
        this.clients.delete(Number(id));
        client?.res.end();
    }

    disconnectInstance(instanceId) {
        for (const [id, client] of this.clients) {
            if (client.instanceId === Number(instanceId)) this.disconnect(id);
        }
    }
}

export default new AgentConnections();
