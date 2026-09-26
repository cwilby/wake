const { createApp, ref, computed, onUnmounted } = Vue;

createApp({
    setup() {
        const instances = ref([]);
        const appVersion = ref('');
        const loading = ref(false);
        const saving = ref(false);
        const wakingId = ref(null);
        const shuttingDownId = ref(null);
        const refreshCountdown = ref(10);
        const autoRefresh = ref(true);
        const dialogOpen = ref(false);
        const editingId = ref(null);
        const form = ref(emptyForm());
        const editTab = ref('machine');
        const scheduleSaving = ref(false);
        const overrideLoading = ref('');
        const wakeScheduleSaving = ref(false);
        const scheduleKind = ref('wake');
        const localTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
        const timezones = [...new Set([localTimezone, 'UTC', ...Intl.supportedValuesOf('timeZone')])];
        const scheduleForm = ref({ enabled: false, time: '00:00', timezone: localTimezone, warning_minutes: 10 });
        const wakeScheduleForm = ref({ enabled: false, time: '08:00', timezone: localTimezone });
        const shutdownInstance = computed(() => instances.value.find(instance => instance.id === editingId.value));
        const strategySaving = ref(false);
        const enrollmentToken = ref('');
        const agentEndpoint = `${window.location.origin}/agent/events`;
        const strategyForm = ref(emptyStrategyForm());

        function emptyForm() {
            return { name: '', active: true, hosts: [], macs: [] };
        }

        function emptyStrategyForm() {
            return { type: 'ssh', platform: 'linux', host: '', private_key: '', shutdown_command: '' };
        }

        async function request(url, options = {}) {
            const response = await fetch(url, {
                ...options,
                headers: { 'Content-Type': 'application/json', ...options.headers }
            });
            if (!response.ok) {
                const data = await response.json().catch(() => ({}));
                throw new Error(data.error || `Request failed (${response.status}).`);
            }
            return response.status === 204 ? null : response.json();
        }

        let foregroundLoads = 0;
        let deepLinkHandled = false;

        async function loadInstances({ background = false } = {}) {
            if (!background) {
                foregroundLoads += 1;
                loading.value = true;
            }
            try {
                instances.value = await request('/instances');
                if (!deepLinkHandled && window.location.search) {
                    const machineId = new URLSearchParams(window.location.search).get('machine');
                    const machine = instances.value.find(item => String(item.id) === machineId);
                    if (machine) { deepLinkHandled = true; openEdit(machine); editTab.value = 'schedule'; scheduleKind.value = 'shutdown'; }
                }
            } catch (error) {
                ElementPlus.ElMessage.error(error.message);
            } finally {
                if (!background) {
                    foregroundLoads -= 1;
                    loading.value = foregroundLoads > 0;
                }
            }
        }

        function refreshNow() {
            refreshCountdown.value = 10;
            return loadInstances();
        }

        function setAutoRefresh(enabled) {
            if (enabled) {
                refreshCountdown.value = 10;
            }
        }

        function openCreate() {
            resetEditor();
            editingId.value = null;
            form.value = emptyForm();
            dialogOpen.value = true;
        }

        function openEdit(instance) {
            resetEditor();
            editingId.value = instance.id;
            if (instance.wake_schedule) wakeScheduleForm.value = { ...instance.wake_schedule };
            if (instance.shutdown_schedule) scheduleForm.value = { ...instance.shutdown_schedule };
            form.value = {
                name: instance.name,
                active: instance.active,
                hosts: instance.hosts.map(host => ({ ...host })),
                macs: instance.macs.map(mac => ({ ...mac }))
            };
            dialogOpen.value = true;
        }

        function addAddress(type) {
            form.value[type].push({ address: '' });
        }

        function removeAddress(type, index) {
            form.value[type].splice(index, 1);
        }

        function payload() {
            const clean = items => items
                .map(item => ({ address: item.address.trim() }))
                .filter(item => item.address);
            return { ...form.value, name: form.value.name.trim(), hosts: clean(form.value.hosts), macs: clean(form.value.macs) };
        }

        async function saveInstance() {
            const data = payload();
            if (!data.name) return ElementPlus.ElMessage.warning('Give this instance a name.');
            if (!data.macs.length) return ElementPlus.ElMessage.warning('Add at least one MAC address to wake this machine.');
            saving.value = true;
            try {
                await request(editingId.value ? `/instances/${editingId.value}` : '/instances', {
                    method: editingId.value ? 'PUT' : 'POST', body: JSON.stringify(data)
                });
                dialogOpen.value = false;
                ElementPlus.ElMessage.success(editingId.value ? 'Instance updated.' : 'Instance added.');
                await loadInstances();
            } catch (error) {
                ElementPlus.ElMessage.error(error.message);
            } finally {
                saving.value = false;
            }
        }

        async function deleteInstance(instance) {
            try {
                await ElementPlus.ElMessageBox.confirm(`Delete “${instance.name}”? This cannot be undone.`, 'Delete instance', {
                    confirmButtonText: 'Delete', cancelButtonText: 'Cancel', type: 'warning'
                });
                await request(`/instances/${instance.id}`, { method: 'DELETE' });
                instances.value = instances.value.filter(item => item.id !== instance.id);
                ElementPlus.ElMessage.success('Instance deleted.');
            } catch (error) {
                if (error !== 'cancel' && error !== 'close') ElementPlus.ElMessage.error(error.message);
            }
        }

        async function wakeInstance(instance) {
            wakingId.value = instance.id;
            try {
                await request(`/instances/${instance.id}/wake`, { method: 'POST' });
                ElementPlus.ElMessage.success(`Wake request sent to ${instance.name}.`);
                await loadInstances();
            } catch (error) {
                ElementPlus.ElMessage.error(error.message);
            } finally {
                wakingId.value = null;
            }
        }

        function resetEditor() {
            editTab.value = 'machine';
            scheduleKind.value = 'wake';
            wakeScheduleForm.value = { enabled: false, time: '08:00', timezone: localTimezone };
            scheduleForm.value = { enabled: false, time: '00:00', timezone: localTimezone, warning_minutes: 10 };
            strategyForm.value = emptyStrategyForm();
            enrollmentToken.value = '';
        }

        async function saveWakeSchedule() {
            wakeScheduleSaving.value = true;
            try {
                await request(`/instances/${editingId.value}/wake-schedule`, {
                    method: 'PUT', body: JSON.stringify(wakeScheduleForm.value)
                });
                await loadInstances();
                ElementPlus.ElMessage.success(wakeScheduleForm.value.enabled ? 'Daily wake scheduled.' : 'Wake schedule disabled.');
            } catch (error) {
                ElementPlus.ElMessage.error(error.message);
            } finally {
                wakeScheduleSaving.value = false;
            }
        }

        async function saveShutdownSchedule() {
            scheduleSaving.value = true;
            try {
                await request(`/instances/${editingId.value}/shutdown-schedule`, {
                    method: 'PUT', body: JSON.stringify(scheduleForm.value)
                });
                await loadInstances();
                ElementPlus.ElMessage.success(scheduleForm.value.enabled ? 'Daily shutdown scheduled.' : 'Shutdown schedule disabled.');
            } catch (error) {
                ElementPlus.ElMessage.error(error.message);
            } finally {
                scheduleSaving.value = false;
            }
        }

        async function overrideShutdown(instance, action) {
            const next = instance.shutdown_schedule?.next_run;
            if (!next) return;
            overrideLoading.value = `${instance.id}:${action}`;
            try {
                await request(`/instances/${instance.id}/shutdown-schedule/override`, {
                    method: 'POST', body: JSON.stringify({ action, expected_due_at: next.due_at })
                });
                await loadInstances();
                ElementPlus.ElMessage.success(action === 'skip' ? 'Next shutdown skipped.' : 'Shutdown delayed by one hour.');
            } catch (error) {
                ElementPlus.ElMessage.error(error.message);
                await loadInstances();
            } finally { overrideLoading.value = ''; }
        }

        async function addShutdownStrategy() {
            const data = { ...strategyForm.value };
            if (data.type === 'ssh' && (!data.host.trim() || !data.private_key.trim())) {
                return ElementPlus.ElMessage.warning('An SSH host and private key are required.');
            }
            strategySaving.value = true;
            try {
                const strategy = await request(`/instances/${shutdownInstance.value.id}/shutdown-strategies`, {
                    method: 'POST', body: JSON.stringify(data)
                });
                enrollmentToken.value = strategy.enrollment_token || '';
                await loadInstances();
                strategyForm.value = emptyStrategyForm();
                ElementPlus.ElMessage.success('Shutdown strategy added.');
            } catch (error) {
                ElementPlus.ElMessage.error(error.message);
            } finally {
                strategySaving.value = false;
            }
        }

        async function removeShutdownStrategy(strategy) {
            try {
                await request(`/instances/${shutdownInstance.value.id}/shutdown-strategies/${strategy.id}`, { method: 'DELETE' });
                shutdownInstance.value.shutdown_strategies = shutdownInstance.value.shutdown_strategies.filter(item => item.id !== strategy.id);
                ElementPlus.ElMessage.success('Shutdown strategy removed.');
            } catch (error) {
                ElementPlus.ElMessage.error(error.message);
            }
        }

        async function shutdownInstanceNow(instance) {
            try {
                await ElementPlus.ElMessageBox.confirm(`Request shutdown for “${instance.name}”?`, 'Shutdown instance', {
                    confirmButtonText: 'Shutdown', cancelButtonText: 'Cancel', type: 'warning'
                });
                shuttingDownId.value = instance.id;
                const result = await request(`/instances/${instance.id}/shutdown`, { method: 'POST' });
                const queued = result.results.some(item => item.status === 'queued');
                ElementPlus.ElMessage.success(queued ? 'Shutdown request queued for the remote agent.' : 'Shutdown command sent.');
            } catch (error) {
                if (error !== 'cancel' && error !== 'close') ElementPlus.ElMessage.error(error.message);
            } finally {
                shuttingDownId.value = null;
            }
        }

        function stateLabel(state) {
            return { awake: 'Host is up', asleep: 'Host is down', 'no-host': 'No host configured' }[state];
        }

        function statusDetail(state) {
            return {
                awake: 'Awake',
                asleep: 'Asleep',
                'no-host': 'Add a host address to check availability.'
            }[state];
        }

        request('/version').then(data => { appVersion.value = data.version; }).catch(() => {});
        loadInstances();
        const refreshTimer = window.setInterval(() => {
            if (!autoRefresh.value) return;
            if (refreshCountdown.value <= 1) {
                refreshCountdown.value = 10;
                loadInstances({ background: true });
            } else {
                refreshCountdown.value -= 1;
            }
        }, 1_000);
        onUnmounted(() => window.clearInterval(refreshTimer));
        return { overrideLoading, overrideShutdown, wakeScheduleSaving, wakeScheduleForm, scheduleKind, saveWakeSchedule, scheduleSaving, scheduleForm, timezones, saveShutdownSchedule, appVersion, instances, loading, saving, wakingId, shuttingDownId, refreshCountdown, autoRefresh, dialogOpen, editingId, form, editTab, shutdownInstance, strategySaving, enrollmentToken, agentEndpoint, strategyForm, loadInstances, refreshNow, setAutoRefresh, openCreate, openEdit, addAddress, removeAddress, saveInstance, deleteInstance, wakeInstance, addShutdownStrategy, removeShutdownStrategy, shutdownInstanceNow, stateLabel, statusDetail };
    }
}).use(ElementPlus).mount('#app');
