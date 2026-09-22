const { createApp, ref, onUnmounted } = Vue;

createApp({
    setup() {
        const instances = ref([]);
        const loading = ref(false);
        const saving = ref(false);
        const wakingId = ref(null);
        const refreshCountdown = ref(10);
        const autoRefresh = ref(true);
        const dialogOpen = ref(false);
        const editingId = ref(null);
        const form = ref(emptyForm());

        function emptyForm() {
            return { name: '', active: true, hosts: [], macs: [] };
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

        async function loadInstances() {
            loading.value = true;
            try {
                instances.value = await request('/instances');
            } catch (error) {
                ElementPlus.ElMessage.error(error.message);
            } finally {
                loading.value = false;
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
            editingId.value = null;
            form.value = emptyForm();
            dialogOpen.value = true;
        }

        function openEdit(instance) {
            editingId.value = instance.id;
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

        loadInstances();
        const refreshTimer = window.setInterval(() => {
            if (!autoRefresh.value) return;
            if (refreshCountdown.value <= 1) {
                refreshCountdown.value = 10;
                loadInstances();
            } else {
                refreshCountdown.value -= 1;
            }
        }, 1_000);
        onUnmounted(() => window.clearInterval(refreshTimer));
        return { instances, loading, saving, wakingId, refreshCountdown, autoRefresh, dialogOpen, editingId, form, loadInstances, refreshNow, setAutoRefresh, openCreate, openEdit, addAddress, removeAddress, saveInstance, deleteInstance, wakeInstance };
    }
}).use(ElementPlus).mount('#app');
