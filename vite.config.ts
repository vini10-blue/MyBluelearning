import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

// Short build id: Vercel commit SHA when deployed, else a local timestamp.
// Surfaced in the footer so we can tell which build is actually loaded
// (iOS PWA caching otherwise makes "deployed" vs "running" ambiguous).
const BUILD_ID =
  process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ??
  new Date().toISOString().slice(0, 16).replace('T', ' ');

// https://vite.dev/config/
export default defineConfig({
  define: {
    __BUILD_ID__: JSON.stringify(BUILD_ID),
  },
  plugins: [
    react(),
    VitePWA({
      // Custom service worker (src/sw.ts) adds a navigation fallback so the
      // router's deep links resolve offline. The `injectManifest` strategy
      // lets us bring our own SW while still getting precache injection.
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.ts',
      // 'prompt' (vs 'autoUpdate'): a new SW is downloaded and waits, but does
      // not take over until the user accepts via UpdatePrompt — autoUpdate would
      // silently reload mid-study-session, which loses drill progress.
      registerType: 'prompt',
      includeAssets: ['favicon.png', 'apple-touch-icon.png'],
      injectManifest: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg,webmanifest}'],
        maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
      },
      manifest: {
        name: 'MyBlueLearning',
        short_name: 'MyBlueLearning',
        description: 'Process-first study for SAP modules and IT certifications',
        theme_color: '#0b3b5e',
        background_color: '#ffffff',
        display: 'standalone',
        orientation: 'portrait',
        start_url: '/',
        scope: '/',
        icons: [
          { src: 'pwa-192x192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512x512.png', sizes: '512x512', type: 'image/png' },
          { src: 'pwa-512x512-maskable.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
    }),
  ],
  server: {
    port: 5173,
    // Bind to localhost by default. To test from a phone on the same network,
    // run `VITE_HOST=lan npm run dev` to expose the dev server on the LAN.
    host: process.env.VITE_HOST === 'lan' ? true : 'localhost',
  },
});
