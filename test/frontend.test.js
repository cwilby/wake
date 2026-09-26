import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

test('remote-agent enrollment retains token through refresh and exposes its endpoint to the template', async () => {
    let ui;
    const requests = [];
    const machine = { id: 1, name: 'Desktop', active: true, hosts: [], macs: [], shutdown_strategies: [] };
    const notificationOption = { type: 'wake_requested', label: 'Start requests', description: 'When a start action is sent.', enabled: true };
    vm.runInNewContext(fs.readFileSync(new URL('../app/public/index.js', import.meta.url), 'utf8'), {
        Vue: {
            ref: value => ({ value }),
            computed: fn => ({ get value() { return fn(); } }),
            onUnmounted() {},
            createApp(options) { ui = options.setup(); return { use() { return this; }, mount() {} }; }
        },
        ElementPlus: { ElMessage: { success() {}, error(message) { throw new Error(message); } } },
        window: {
            location: { origin: 'http://wake.test:8091' }, setInterval() {}, clearInterval() {}, setTimeout() {},
            localStorage: { getItem() {}, setItem() {} }
        },
        fetch: async (_url, options = {}) => {
            requests.push({ url: _url, ...options });
            return ({
            ok: true, status: options.method === 'POST' ? 201 : 200,
            json: async () => _url === '/version' ? { version: '2.3.4' }
                : _url === '/notification-preferences' ? [notificationOption]
                    : options.method === 'POST' ? { id: 2, type: 'remote-agent', enrollment_token: 'test-enrollment-token' }
                        : [structuredClone(machine)]
        });
        }
    });
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(ui.appVersion.value, '2.3.4');
    assert.equal('notifications' in ui, false);
    await ui.openNotificationSettings();
    assert.equal(ui.notificationPreferences.value[0].enabled, true);
    await ui.setNotificationPreference(ui.notificationPreferences.value[0], false);
    assert.equal(ui.notificationPreferences.value[0].enabled, false);
    assert.equal(requests.some(request => request.url.endsWith('/notification-preferences/wake_requested') && request.method === 'PUT'), true);
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
    ui.editTab.value = 'schedule';
    ui.scheduleForm.value = { enabled: true, time: '00:00', timezone: 'America/Los_Angeles', warning_minutes: 15 };
    await ui.saveShutdownSchedule();
    const saved = requests.find(request => request.url.endsWith('/shutdown-schedule'));
    assert.equal(saved.method, 'PUT');
    assert.deepEqual(JSON.parse(saved.body), { enabled: true, time: '00:00', timezone: 'America/Los_Angeles', warning_minutes: 15 });
    assert.equal(ui.scheduleForm.value.enabled, true, 'refresh must not reset the edited schedule');
    ui.scheduleKind.value = 'wake';
    ui.wakeScheduleForm.value = { enabled: true, time: '08:30', timezone: 'UTC' };
    await ui.saveWakeSchedule();
    const savedWake = requests.find(request => request.url.endsWith('/wake-schedule'));
    assert.deepEqual(JSON.parse(savedWake.body), { enabled: true, time: '08:30', timezone: 'UTC' });
    assert.equal(ui.scheduleForm.value.warning_minutes, 15, 'wake editing preserves shutdown settings');
    ui.openCreate();
    assert.equal(ui.wakeScheduleForm.value.enabled, false);
    assert.equal(ui.wakeScheduleForm.value.time, '08:00');
    assert.equal(ui.scheduleForm.value.enabled, false);
    assert.equal(ui.scheduleForm.value.time, '00:00');
    assert.equal(ui.scheduleForm.value.warning_minutes, 10);
    assert.equal(ui.enrollmentToken.value, '');
});
