export async function sendPhoneNotification(notification, { env = process.env, fetchRequest = fetch } = {}) {
    const token = env.WAKE_PUSHOVER_APP_TOKEN;
    const user = env.WAKE_PUSHOVER_USER_KEY;
    if (!token || !user || !env.WAKE_PUBLIC_URL) throw new Error('Configure WAKE_PUSHOVER_APP_TOKEN, WAKE_PUSHOVER_USER_KEY, and WAKE_PUBLIC_URL for phone notifications.');
    const url = new URL(env.WAKE_PUBLIC_URL);
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) throw new Error('WAKE_PUBLIC_URL must be an HTTP(S) URL without credentials.');
    if (notification.type === 'shutdown_warning') url.searchParams.set('machine', notification.instance_id);
    const body = new URLSearchParams({ token, user, title: notification.title.slice(0, 250), message: notification.message.slice(0, 1024),
        url: url.href, url_title: notification.type === 'shutdown_warning' ? 'Open Wake: skip or delay' : 'Open Wake', priority: '0' });
    if (notification.expires_at != null) {
        const ttl = Math.ceil((notification.expires_at - Date.now()) / 1000);
        if (ttl <= 0) return;
        body.set('ttl', String(ttl));
    }
    if (env.WAKE_PUSHOVER_DEVICE) body.set('device', env.WAKE_PUSHOVER_DEVICE);
    const response = await fetchRequest('https://api.pushover.net/1/messages.json', {
        method: 'POST', body, signal: AbortSignal.timeout(10_000), redirect: 'error'
    });
    const result = await response.json();
    if (!response.ok || result.status !== 1) throw new Error(`Pushover rejected the notification (HTTP ${response.status}). Check the server configuration.`);
}
