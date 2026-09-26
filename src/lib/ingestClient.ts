import { msalInstance } from '../auth/msal';
import type { Citation, Item, SourceDocument, SourceKind } from './types';

/**
 * Client for POST /api/ingest.
 *
 * Mirrors the expenses app's extractReceipt.ts: a typed error subclass so
 * callers switch on a code rather than scraping a string, a code→copy map so
 * the server only ever returns short codes and never raw internals, the Entra
 * ID token as the bearer, and one retry on a network blip with a specific
 * message when the device is simply offline.
 *
 * The two passes are separate calls on purpose. Between them the learner sees
 * the process model and its verification numbers and decides whether it is
 * worth spending a second Opus call generating drills against it. A bad map
 * caught here costs one call; caught after items exist it costs two and a
 * pack full of questions about the wrong process.
 */

/** What the client sends to describe a source. Same shape the server reads. */
export interface SourceRefInput {
  kind: SourceKind;
  origin: string;
  title: string;
  dataBase64?: string;
  pageFrom?: number;
  pageTo?: number;
}

/** A chunk as the server returns it; passed back verbatim for pass 2. */
export interface SourceChunkRef {
  sourceId: string;
  locator: string;
  url?: string;
  text: string;
}

export interface VerificationStats {
  citationsTotal: number;
  citationsFound: number;
  tokensTotal?: number;
  tokensFound?: number;
  failures: Record<string, number>;
}

export interface Usage {
  input_tokens: number;
  output_tokens: number;
  cache_read_input_tokens: number | null;
}

export interface ProcessPassResponse {
  /** The raw settled process model. Run validateCoursePack before trusting it. */
  process: unknown;
  sources: SourceDocument[];
  chunks: SourceChunkRef[];
  pageWindow?: { totalPages: number; pageFrom: number; pageTo: number };
  verification: VerificationStats;
  usage: Usage;
  requestId: string;
}

export interface ItemsPassResponse {
  items: Item[];
  verification: VerificationStats;
  /** The server says this out loud: answer keys are model judgement. */
  unverifiable: string;
  usage: Usage;
  requestId: string;
}

interface ErrorBody {
  error?: string;
  detail?: string;
  requestId?: string;
}

export class IngestError extends Error {
  // Plain field declarations — erasableSyntaxOnly forbids parameter properties.
  readonly status: number;
  readonly code: string;
  readonly requestId?: string;

  constructor(status: number, code: string, message: string, requestId?: string) {
    super(message);
    this.name = 'IngestError';
    this.status = status;
    this.code = code;
    this.requestId = requestId;
  }
}

/**
 * Server codes → copy safe to show. Where the server sends a `detail` it is
 * already user-safe prose (the source adapters write theirs for the reader)
 * and is preferred over these defaults.
 */
const FRIENDLY_MESSAGES: Record<string, string> = {
  unauthorized: 'Microsoft sign-in could not be verified. Sign out and back in.',
  missing_token: 'Microsoft sign-in could not be verified. Sign out and back in.',
  invalid_token: 'Your session expired. Sign out and back in, then retry.',
  wrong_tenant: 'This account is not allowed to use ingest.',
  not_authorized: 'This account is not authorised to use ingest.',
  rate_limited: 'Too many ingest calls in a short time. Wait a few minutes and retry.',
  upstream_rate_limited: 'The model is busy right now. Wait a minute and retry.',
  bad_request: 'That source could not be used. Check the URL or file and try again.',
  invalid_url: 'That is not a valid URL.',
  host_not_allowed: 'Only help.sap.com pages and PDFs can be fetched. Upload anything else as a PDF.',
  fetch_failed: 'SAP Help did not return that document. Check the URL is public and try again.',
  page_not_readable:
    'That page returned almost no readable text — it is probably rendered by JavaScript. Use the PDF bundle for this topic instead.',
  source_too_large: 'That document is too large to ingest in one go. Use a smaller page window.',
  payload_too_large: 'That PDF is too large. Try a smaller file or a page window.',
  invalid_encoding: 'That file could not be read. Try uploading it again.',
  unsupported_source_kind: 'Unsupported source type.',
  pdf_unreadable: 'That file could not be read as a PDF.',
  pdf_empty: 'That PDF has no pages.',
  page_range_empty: 'That page range is outside the document.',
  no_readable_text:
    'Those pages contain almost no extractable text. A scanned document needs OCR first.',
  empty_response: 'The model returned nothing. Try again.',
  unparseable_response: 'The model returned something unreadable. Try again.',
  upstream_bad_request: 'The ingest service sent a bad request to the model. This is a bug — note the request id.',
  upstream_error: 'The model service had a problem. Please try again.',
  config_error: 'The ingest service is not fully configured. The API key is missing on the server.',
  internal_error: 'The ingest service had an unexpected problem. Note the request id.',
};

async function getAuthHeader(): Promise<string> {
  const account = msalInstance.getActiveAccount() ?? msalInstance.getAllAccounts()[0];
  if (!account) {
    throw new IngestError(401, 'not_signed_in', 'You are signed out. Sign in again to ingest.');
  }
  try {
    const result = await msalInstance.acquireTokenSilent({ account, scopes: ['User.Read'] });
    return `Bearer ${result.idToken}`;
  } catch {
    throw new IngestError(401, 'auth_expired', 'Your session expired. Sign out and back in, then retry.');
  }
}

async function postWithRetry(body: unknown, authHeader: string): Promise<Response> {
  const json = JSON.stringify(body);
  let lastError: unknown = null;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      return await fetch('/api/ingest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: authHeader },
        body: json,
      });
    } catch (e) {
      lastError = e;
      if (typeof navigator !== 'undefined' && navigator.onLine === false) {
        throw new IngestError(0, 'offline', 'You appear to be offline. Reconnect and try again.');
      }
      if (attempt === 0) await new Promise((r) => setTimeout(r, 800));
    }
  }
  const detail = lastError instanceof Error ? lastError.message : 'Network error';
  throw new IngestError(0, 'network', `Couldn't reach the ingest service (${detail}). Check your connection.`);
}

async function call<T>(body: unknown): Promise<T> {
  const res = await postWithRetry(body, await getAuthHeader());
  if (!res.ok) {
    let parsed: ErrorBody = {};
    try {
      parsed = (await res.json()) as ErrorBody;
    } catch {
      // fall through with defaults
    }
    const code = parsed.error ?? 'unknown';
    const message =
      parsed.detail ??
      FRIENDLY_MESSAGES[code] ??
      `The ingest service returned an error (HTTP ${res.status}).`;
    throw new IngestError(res.status, code, message, parsed.requestId);
  }
  return (await res.json()) as T;
}

/** Pass 1: source → process model. */
export function runProcessPass(source: SourceRefInput): Promise<ProcessPassResponse> {
  return call<ProcessPassResponse>({ pass: 'process', source });
}

/** Pass 2: process model + the same chunks → items. */
export function runItemsPass(
  process: unknown,
  chunks: SourceChunkRef[],
): Promise<ItemsPassResponse> {
  return call<ItemsPassResponse>({ pass: 'items', process, chunks });
}

/** Read a File as standard base64 (no data: prefix), for `user-pdf` sources. */
export function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Could not read that file.'));
    reader.onload = () => {
      const result = String(reader.result ?? '');
      const comma = result.indexOf(',');
      resolve(comma >= 0 ? result.slice(comma + 1) : result);
    };
    reader.readAsDataURL(file);
  });
}

/** A source with its origin decides its kind: `.pdf` on help.sap.com is a bundle. */
export function kindForUrl(url: string): SourceKind {
  return /\.pdf(\?|#|$)/i.test(url) ? 'sap-help-pdf' : 'sap-help-page';
}

/** Convenience for screens that summarise a pass. */
export function foundRatio(v: VerificationStats): string {
  return `${v.citationsFound}/${v.citationsTotal}`;
}

export type { Citation };
