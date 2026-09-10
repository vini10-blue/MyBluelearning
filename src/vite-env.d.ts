/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/react" />

interface ImportMetaEnv {
  /** Microsoft Entra app registration — Application (client) ID. */
  readonly VITE_MSAL_CLIENT_ID: string;
  /** Microsoft Entra app registration — Directory (tenant) ID for Blue Lagoon. */
  readonly VITE_MSAL_TENANT_ID: string;
  /**
   * Where the app is running. Must match a redirect URI registered in Entra.
   * Local dev: http://localhost:5173
   * Production: set to the Vercel production URL once the project exists.
   *
   * NOTE: this is a SEPARATE Entra app registration from the expenses app.
   * Reusing that one would mean adding this app's origins to its redirect URIs,
   * which widens the blast radius of either app being compromised.
   */
  readonly VITE_APP_URL: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

/** Injected at build time (vite.config.ts) — short commit SHA / timestamp. */
declare const __BUILD_ID__: string;
