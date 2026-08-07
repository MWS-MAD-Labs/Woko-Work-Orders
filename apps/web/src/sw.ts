/// <reference lib="WebWorker" />

import { clientsClaim } from 'workbox-core';
import { precacheAndRoute } from 'workbox-precaching';

declare const self: ServiceWorkerGlobalScope & { __WB_MANIFEST: Array<unknown> };

self.skipWaiting();
clientsClaim();
precacheAndRoute(self.__WB_MANIFEST);

type PushPayload = {
  title?: string;
  body?: string;
  notificationId?: string;
  workOrderId?: string | null;
  targetUrl?: string;
};

self.addEventListener('push', (event) => {
  const payload = event.data?.json() as PushPayload | undefined;
  const title = payload?.title ?? 'Woko';
  const body = payload?.body ?? 'You have a new notification.';
  const target = payload?.targetUrl ?? (payload?.workOrderId ? `/?workOrder=${encodeURIComponent(payload.workOrderId)}` : '/');

  event.waitUntil(self.registration.showNotification(title, {
    body,
    icon: '/icon-192.png',
    badge: '/icon-192.png',
    tag: payload?.notificationId ?? undefined,
    data: { target },
  }));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = new URL(event.notification.data?.target ?? '/', self.location.origin).href;
  event.waitUntil((async () => {
    const client = (await self.clients.matchAll({ type: 'window', includeUncontrolled: true }))
      .find((candidate) => 'focus' in candidate);
    if (client) {
      await client.navigate(target);
      return client.focus();
    }
    return self.clients.openWindow(target);
  })());
});
