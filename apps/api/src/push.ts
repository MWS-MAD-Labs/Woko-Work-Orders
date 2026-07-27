import webpush from 'web-push';
import { config } from './config.js';

export type StoredPushSubscription = {
  endpoint: string;
  p256dh: string;
  auth: string;
};

export type PushPayload = {
  title: string;
  body: string;
  notificationId: string;
  workOrderId: string | null;
};

if (config.WEB_PUSH_ENABLED) {
  webpush.setVapidDetails(config.WEB_PUSH_SUBJECT, config.WEB_PUSH_VAPID_PUBLIC_KEY!, config.WEB_PUSH_VAPID_PRIVATE_KEY!);
}

export function webPushEnabled(): boolean {
  return config.WEB_PUSH_ENABLED;
}

export function webPushPublicKey(): string | undefined {
  return config.WEB_PUSH_VAPID_PUBLIC_KEY;
}

export async function sendPushNotification(subscription: StoredPushSubscription, payload: PushPayload) {
  if (!config.WEB_PUSH_ENABLED) return;
  await webpush.sendNotification({
    endpoint: subscription.endpoint,
    keys: { p256dh: subscription.p256dh, auth: subscription.auth },
  }, JSON.stringify(payload), { TTL: 60 * 60 * 24 });
}

export function pushSubscriptionHasExpired(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'statusCode' in error
    && ((error as { statusCode?: unknown }).statusCode === 404 || (error as { statusCode?: unknown }).statusCode === 410);
}
