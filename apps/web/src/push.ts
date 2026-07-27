import { api } from './api';

type PushConfiguration = { enabled: boolean; publicKey: string | null };

function urlBase64ToUint8Array(value: string): Uint8Array<ArrayBuffer> {
  const padded = value.padEnd(value.length + (4 - value.length % 4) % 4, '=');
  const decoded = atob(padded.replaceAll('-', '+').replaceAll('_', '/'));
  return Uint8Array.from(decoded, (character) => character.charCodeAt(0));
}

function supportsPushNotifications(): boolean {
  return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
}

export async function subscribeToPushNotifications(): Promise<'subscribed' | 'unsupported' | 'unavailable' | 'denied'> {
  if (!supportsPushNotifications()) return 'unsupported';
  const configuration = await api<PushConfiguration>('/notifications/push-public-key');
  if (!configuration.enabled || !configuration.publicKey) return 'unavailable';

  const permission = Notification.permission === 'default' ? await Notification.requestPermission() : Notification.permission;
  if (permission !== 'granted') return 'denied';

  const registration = await navigator.serviceWorker.ready;
  const subscription = await registration.pushManager.getSubscription()
    ?? await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(configuration.publicKey) });
  await api('/notifications/push-subscription', { method: 'PUT', body: JSON.stringify(subscription.toJSON()) });
  return 'subscribed';
}
