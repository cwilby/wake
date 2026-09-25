import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

test('remote-agent enrollment retains token through refresh and exposes its endpoint to the template', async () => {
    let ui;
    const machine = { id: 1, name: 'Desktop', active: true, hosts: [], macs: [], shutdown_strategies: [] };
    vm.runInNewContext(fs.readFileSync(new URL('../app/public/index.js', import.meta.url), 'utf8'), {
        Vue: {
            ref: value => ({ value }),
            computed: fn => ({ get value() { return fn(); } }),
            onUnmounted() {},
            createApp(options) { ui = options.setup(); return { use() { return this; }, mount() {} }; }
        },
        ElementPlus: { ElMessage: { success() {}, error(message) { throw new Error(message); } } },
        window: { location: { origin: 'http://wake.test:8091' }, setInterval() {}, clearInterval() {} },
        fetch: async (_url, options = {}) => ({
            ok: true, status: options.method === 'POST' ? 201 : 200,
            json: async () => _url === '/version' ? { version: '2.3.4' } : options.method === 'POST'
                ? { id: 2, type: 'remote-agent', enrollment_token: 'test-enrollment-token' }
                : [structuredClone(machine)]
        })
    });
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(ui.appVersion.value, '2.3.4');
    ui.openEdit(ui.instances.value[0]);
    ui.editTab.value = 'shutdown';
    ui.strategyForm.value.type = 'remote-agent';
    await ui.addShutdownStrategy();
    await ui.loadInstances({ background: true });
    assert.equal(ui.enrollmentToken.value, 'test-enrollment-token');
    assert.equal(ui.agentEndpoint, 'http://wake.test:8091/agent/events');
    assert.equal(ui.dialogOpen.value, true);
    assert.equal(ui.editTab.value, 'shutdown');
    const template = fs.readFileSync(new URL('../app/public/index.html', import.meta.url), 'utf8');
    assert.match(template, /\{\{ agentEndpoint \}\}/);
    assert.doesNotMatch(template, /\{\{\s*location\./);
    ui.openCreate();
    assert.equal(ui.enrollmentToken.value, '');
});
