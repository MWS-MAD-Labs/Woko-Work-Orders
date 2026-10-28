import { fileURLToPath } from 'node:url';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

// The one .env lives in the repo root, so Vite reads it from there: the web port is the one in WEB_ORIGIN and /api goes to
// the API's PORT. The port is strict, so a taken port stops the start instead of moving to another app's port.
const rootDir = fileURLToPath(new URL('../..', import.meta.url));
const env = loadEnv('development', rootDir, '');
const webPort = Number(new URL(env.WEB_ORIGIN || 'http://localhost:5177').port) || 5177;

export default defineConfig({
  envDir: rootDir,
  server: { port: webPort, strictPort: true, proxy: { '/api': `http://localhost:${env.PORT || 3011}` } },
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.ts',
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
