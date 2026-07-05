self.addEventListener('install', (event) => {
    event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', (event) => {
    event.waitUntil(self.clients.claim());
});

self.addEventListener('notificationclick', (event) => {
    event.notification.close();

    const targetUrl = event.notification?.data?.url || '/';

    event.waitUntil((async () => {
        const clientList = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });

        for (const client of clientList) {
            const sameOrigin = client.url.startsWith(self.location.origin);
            if (!sameOrigin) continue;

            if ('navigate' in client && targetUrl) {
                await client.navigate(targetUrl);
            }

            if ('focus' in client) {
                await client.focus();
            }
            return;
        }

        if (self.clients.openWindow) {
            await self.clients.openWindow(targetUrl);
        }
    })());
});