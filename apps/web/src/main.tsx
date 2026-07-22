import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { registerSW } from 'virtual:pwa-register';
import App from './App';
import './styles.css';

if (import.meta.env.DEV && 'serviceWorker' in navigator) {
  void navigator.serviceWorker.getRegistrations().then(async (registrations) => {
    await Promise.all(registrations.map((registration) => registration.unregister()));
    if ('caches' in window) await Promise.all((await caches.keys()).map((cacheName) => caches.delete(cacheName)));
  });
} else {
  registerSW({
    immediate: true,
    onRegisteredSW(_url, registration) {
      if (registration) window.setInterval(() => void registration.update(), 60 * 60 * 1000);
    },
  });
}

createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>);
