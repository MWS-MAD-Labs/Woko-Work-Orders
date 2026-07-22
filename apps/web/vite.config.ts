import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  server: { proxy: { '/api': 'http://localhost:3001' } },
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icon.svg', 'favicon.ico', 'apple-touch-icon.png', 'icon-maskable-512.png'],
      manifest: {
        id: '/',
        name: 'Woko',
        short_name: 'Woko',
        description: 'Work Order',
        lang: 'id',
        theme_color: '#8dd7f7',
        background_color: '#f6fbfd',
        display: 'standalone',
        scope: '/',
        start_url: '/',
        prefer_related_applications: false,
        icons: [
          { src: '/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: '/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [/^\/api\//],
        cleanupOutdatedCaches: true,
        clientsClaim: true,
        skipWaiting: true,
      },
    }),
  ],
});
