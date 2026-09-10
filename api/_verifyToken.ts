import { createRemoteJWKSet, jwtVerify } from 'jose';
import type { JWTPayload } from 'jose';

/**
 * Verifies the Microsoft Entra (Azure AD) ID token the PWA presents on every
 * /api/ingest call. This is what keeps the endpoint from being an open,
 * anonymous proxy to the Anthropic API: only a signed-in Blue Lagoon account
 * (our tenant, our app registration) can drive it.
 *
 * `_`-prefixed files in api/ are helpers, imported by the real endpoint.
 *
 * Config: the Entra tenant id and SPA client id. These are NOT secrets — they
 * are public identifiers that appear in every ID token and in the browser
 * bundle already. Dedicated server vars (MSAL_TENANT_ID / MSAL_CLIENT_ID) are
 * used if present, otherwise the VITE_-prefixed values the client app uses.
 * Env is read at REQUEST time, not module-load time, so it does not depend on
 * env being populated before this module is first evaluated.
 */

export class AuthError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string) {
    super(code);
    this.name = 'AuthError';
    this.status = status;
    this.code = code;
  }
}

export interface VerifiedUser {
  /** Entra object id — stable per user; used as the rate-limit key. */
  oid: string;
}

// createRemoteJWKSet caches the signing keys internally and refreshes them on
// rotation. Cached per tenant so a warm instance reuses it.
let jwksCache: ReturnType<typeof createRemoteJWKSet> | null = null;
let jwksTenant = '';
function jwks(tenantId: string): ReturnType<typeof createRemoteJWKSet> {
  if (!jwksCache || jwksTenant !== tenantId) {
    jwksCache = createRemoteJWKSet(
      new URL(`https://login.microsoftonline.com/${tenantId}/discovery/v2.0/keys`),
    );
    jwksTenant = tenantId;
  }
  return jwksCache;
}

/**
 * Verify an `Authorization: Bearer <id_token>` header. Resolves to the
 * verified user on success; throws `AuthError` (with an HTTP status) on any
 * failure. Fails closed if the config is missing.
 */
export async function verifyRequestToken(
  authHeader: string | undefined,
): Promise<VerifiedUser> {
  // `||` (not `??`): an env var that exists but is empty must also fall back.
  const tenantId = process.env.MSAL_TENANT_ID || process.env.VITE_MSAL_TENANT_ID;
  const clientId = process.env.MSAL_CLIENT_ID || process.env.VITE_MSAL_CLIENT_ID;
  if (!tenantId || !clientId) {
    // eslint-disable-next-line no-console
    console.error(
      '[api/auth] auth config missing —',
      `tenantId=${tenantId ? 'set' : 'MISSING'}`,
      `clientId=${clientId ? 'set' : 'MISSING'}`,
    );
    throw new AuthError(500, 'config_error');
  }
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    throw new AuthError(401, 'missing_token');
  }
  const token = authHeader.slice(7).trim();
  if (!token) {
    throw new AuthError(401, 'missing_token');
  }

  let payload: JWTPayload;
  try {
    const verified = await jwtVerify(token, jwks(tenantId), {
      // v2.0 endpoint issues ID tokens with this exact issuer; `aud` is our
      // app's client id. jwtVerify enforces both, plus signature and expiry.
      issuer: `https://login.microsoftonline.com/${tenantId}/v2.0`,
      audience: clientId,
    });
    payload = verified.payload;
  } catch {
    throw new AuthError(401, 'invalid_token');
  }

  // Belt-and-suspenders: the token must belong to our tenant.
  if (payload.tid !== tenantId) {
    throw new AuthError(401, 'wrong_tenant');
  }
  const oid = typeof payload.oid === 'string' ? payload.oid : undefined;
  if (!oid) {
    throw new AuthError(401, 'invalid_token');
  }

  // Optional per-user allowlist. ALLOWED_USER_OIDS is a comma-separated list
  // of Entra object ids. When it is unset the endpoint accepts any user in
  // the tenant (and logs a notice) — an unset/empty var must never lock the
  // owner out. To find an oid: sign in, then in the browser console run
  // `JSON.parse(atob(<idToken>.split('.')[1])).oid`.
  const allowList = (process.env.ALLOWED_USER_OIDS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (allowList.length > 0) {
    if (!allowList.includes(oid)) {
      throw new AuthError(403, 'not_authorized');
    }
  } else {
    // eslint-disable-next-line no-console
    console.warn('[api/auth] ALLOWED_USER_OIDS unset — accepting any tenant user');
  }

  return { oid };
}
