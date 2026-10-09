import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';

/**
 * PWA strategy — docs/architecture.md §8.4
 *  - App Shell precache + `navigateFallback: index.html` for SPA deep links.
 *  - `/api/v1/` GET → NetworkFirst (3s timeout) so the app stays readable offline.
 *  - `/api/v1/` non-GET → NetworkOnly: V1 has no offline write queue, a write while
 *    offline must fail loudly (a Toast) instead of being silently queued.
 */
export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      // `robots.txt` is the only public asset the globPatterns extension list
      // does not already catch (no .txt), so it is the only extra entry needed.
      includeAssets: ['robots.txt'],
      manifest: {
        name: 'ToDoList',
        short_name: 'ToDoList',
        description: 'A project context brain: workspace, list, task.',
        lang: 'zh-CN',
        theme_color: '#0a0a0a',
        background_color: '#ffffff',
        display: 'standalone',
        start_url: '/',
        scope: '/',
        icons: [
          {
            src: '/icons/icon-192.png',
            sizes: '192x192',
            type: 'image/png',
            purpose: 'any',
          },
          {
            src: '/icons/icon-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'any',
          },
          {
            src: '/icons/maskable-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
          {
            src: '/icons/apple-touch-icon.png',
            sizes: '180x180',
            type: 'image/png',
            purpose: 'any',
          },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [
          /^\/api/,
          /^\/admin/,
          /^\/static/,
          /^\/media/,
          /^\/downloads/,
        ],
        cleanupOutdatedCaches: true,
        runtimeCaching: [
          {
            // Read path: serve cached data when the network is slow or absent.
            urlPattern: ({ url, request }: { url: URL; request: Request }) =>
              request.method === 'GET' && url.pathname.startsWith('/api/v1/'),
            handler: 'NetworkFirst',
            options: {
              cacheName: 'api-cache',
              networkTimeoutSeconds: 3,
              expiration: { maxEntries: 200, maxAgeSeconds: 86400 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          {
            // Write path: never cached, never queued (architecture §2.2).
            urlPattern: ({ url, request }: { url: URL; request: Request }) =>
              request.method !== 'GET' && url.pathname.startsWith('/api/v1/'),
            handler: 'NetworkOnly',
          },
        ],
      },
      devOptions: { enabled: false },
    }),
  ],
  server: {
    proxy: {
      '/api': {
        target: 'http://localhost:8000',
        changeOrigin: true,
      },
    },
  },
  build: {
    sourcemap: false,
  },
});
