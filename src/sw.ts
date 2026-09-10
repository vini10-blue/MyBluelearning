/// <reference lib="webworker" />

import {
  createHandlerBoundToURL,
  precacheAndRoute,
} from 'workbox-precaching';
import { NavigationRoute, registerRoute } from 'workbox-routing';

/**
 * Custom service worker. Two responsibilities:
 *
 * 1. Precache the build output (Workbox manifest injected at build time).
 * 2. Serve the app shell for any navigation request, so the router's deep
 *    links (/deck/:id, /drill/sequence/:nodeId, …) resolve offline instead
 *    of 404ing. The expenses-app SW had no navigation fallback because that
 *    app has no router — every screen was a phase of one page.
 *
 * Deliberately NOT here: runtime caching of Microsoft Graph responses. Those
 * carry an Authorization header and a short-lived token; caching them in the
 * SW would either leak authenticated content into a shared cache or serve
 * responses whose token has expired. Course packs are cached by the app layer
 * after a successful fetch instead — see src/lib/coursePackCache.ts.
 */

declare const self: ServiceWorkerGlobalScope;

// Precache assets emitted by the Vite build.
precacheAndRoute(self.__WB_MANIFEST);

// App-shell fallback for client-side routes. Anything under /api/ is excluded
// so serverless calls always hit the network.
registerRoute(
  new NavigationRoute(createHandlerBoundToURL('index.html'), {
    denylist: [/^\/api\//],
  }),
);

// Update lifecycle. registerType is 'prompt' (vite.config.ts): a new SW
// downloads, then WAITS until the user taps the UpdatePrompt banner, which
// posts SKIP_WAITING and reloads with fresh assets. Activating silently would
// swap the bundle mid-drill and lose in-progress answers.
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    void self.skipWaiting();
  }
});
self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});
