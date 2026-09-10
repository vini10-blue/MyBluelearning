import type { VercelRequest, VercelResponse } from '@vercel/node';
import { randomUUID } from 'node:crypto';
import Anthropic from '@anthropic-ai/sdk';
// NB: `.js` extension is required — Vercel runs this as a Node ES module,
// and Node ESM does not resolve extensionless relative imports.
import { AuthError, verifyRequestToken } from './_verifyToken.js';
import type { VerifiedUser } from './_verifyToken.js';
import { checkRateLimit } from './_rateLimit.js';
import { SourceError, fetchSapHelpPage } from './_sources.js';
import type { SourceChunk, SourceRef } from './_sources.js';
import { settleCitations } from './_verifyQuotes.js';
import type { ClaimedCitation } from './_verifyQuotes.js';

/**
 * POST /api/ingest
 *
 * Turns source documents into a course pack, in two passes:
 *
 *   { pass: 'process', source: SourceRef }   → { process, sources, chunks }
 *   { pass: 'items', process, chunks }       → { items }
 *
 * Two passes rather than one because a single call would ask the model to hold
 * the whole process model *and* invent drills against it simultaneously, and
 * structured-output quality degrades as the schema grows. Splitting also lets
 * items be regenerated or topped up later without rebuilding the map.
 *
 * The client orchestrates the passes. That is deliberate: Vercel caps function
 * duration, so a single call that ingested a whole document would time out on
 * anything real. Bounded work per call, sequenced by the caller.
 *
 * Model notes:
 * - Opus 5. This is not the receipt-extraction job the expenses app does — it
 *   is reading technical documentation and building a causal model of a
 *   process, including why each step exists and what fails without it. That is
 *   the reasoning tier.
 * - Adaptive thinking. It is on by default on Opus 5, and disabling it also
 *   risks tool-call-shaped text leaking into the visible response, so it stays.
 * - Streaming with `.finalMessage()` because the process model can be a large
 *   JSON payload and a non-streaming request that size risks an HTTP timeout.
 * - The source chunks are cached: pass 2 sends the same chunks as pass 1, and
 *   a retry re-sends them again.
 * - Structured outputs and Anthropic's native citations are mutually exclusive
 *   (the combination is a 400), which is one more reason citations here are
 *   verified mechanically against the chunk text instead.
 */

/** Citation shape the model produces. Note what is absent: `verified`. */
const CITATION_SCHEMA = {
  type: 'object',
  properties: {
    sourceId: { type: 'string', description: 'Id of the source document this came from.' },
    sourceTitle: { type: 'string' },
    locator: { type: 'string', description: 'Where in the source, e.g. a section heading.' },
    quote: {
      type: 'string',
      description:
        'A VERBATIM span copied character-for-character from the cited chunk, at least one full sentence. Never paraphrase. This is checked automatically against the source text.',
    },
  },
  required: ['sourceId', 'sourceTitle', 'locator', 'quote'],
  additionalProperties: false,
} as const;

const PROCESS_SCHEMA = {
  type: 'object',
  properties: {
    title: { type: 'string' },
    module: { type: 'string' },
    summary: {
      type: 'string',
      description: 'One paragraph orienting the learner. Say what the process is FOR.',
    },
    nodes: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'kebab-case, stable, e.g. "warehouse-task".' },
          label: { type: 'string' },
          kind: { type: 'string', enum: ['step', 'document', 'object', 'decision', 'system'] },
          what: { type: 'string', description: 'What this is. One or two sentences.' },
          why: {
            type: 'string',
            description:
              'WHY this step exists in the process — what it makes possible, what it authorises, what problem it solves. Not a restatement of what it is.',
          },
          breaksIf: {
            type: 'string',
            description:
              'What goes wrong DOWNSTREAM if this is skipped, missing or misconfigured. Be concrete about the observable symptom.',
          },
          tcodes: { type: 'array', items: { type: 'string' } },
          configPath: { anyOf: [{ type: 'string' }, { type: 'null' }] },
          citations: { type: 'array', items: CITATION_SCHEMA, minItems: 1 },
        },
        required: ['id', 'label', 'kind', 'what', 'why', 'breaksIf', 'citations'],
        additionalProperties: false,
      },
    },
    edges: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          from: { type: 'string' },
          to: { type: 'string' },
          label: { type: 'string', description: 'What flows, or what triggers the next step.' },
          condition: { anyOf: [{ type: 'string' }, { type: 'null' }] },
          citations: { type: 'array', items: CITATION_SCHEMA, minItems: 1 },
        },
        required: ['id', 'from', 'to', 'label', 'citations'],
        additionalProperties: false,
      },
    },
    failureModes: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          symptom: { type: 'string', description: 'What the practitioner observes.' },
          cause: { type: 'string' },
          nodeIds: { type: 'array', items: { type: 'string' } },
          resolution: { type: 'string' },
          citations: { type: 'array', items: CITATION_SCHEMA, minItems: 1 },
        },
        required: ['id', 'symptom', 'cause', 'nodeIds', 'resolution', 'citations'],
        additionalProperties: false,
      },
    },
    happyPath: {
      type: 'array',
      items: { type: 'string' },
      description: 'Node ids of the canonical path, in order.',
    },
  },
  required: ['title', 'module', 'summary', 'nodes', 'edges', 'failureModes', 'happyPath'],
  additionalProperties: false,
} as const;

const PROCESS_SYSTEM_PROMPT = `You build process models from technical documentation for a study tool.

The learner's goal is to UNDERSTAND A PROCESS, not to memorise facts. Everything you produce is judged against that.

For every node you MUST supply three distinct things:
- what: the definition.
- why: why this step exists in the process — what it authorises, enables, or prevents. This is NOT a restatement of "what". If you cannot say why a step exists from the source, omit the node entirely.
- breaksIf: the concrete downstream symptom when this step is skipped, missing or misconfigured.

CITATIONS — the most important rule:
- Every node, edge and failure mode needs at least one citation.
- A citation's "quote" must be copied VERBATIM from the chunk text you were given: character for character, at least one complete sentence.
- NEVER paraphrase, summarise, tidy, or reconstruct a quote. The quote is checked automatically against the source text; a paraphrase fails that check and the content is discarded.
- Only cite the sourceId whose chunk actually contains the quote.
- If the source does not support a claim, do not make the claim. A short accurate model beats a long speculative one.

Do not add knowledge from memory. Transaction codes, configuration paths, table and object names must come from the provided text or be omitted. Inventing a plausible T-code is the single worst failure available to you: it will be drilled into the learner as if it were true.

Model the process the source actually describes. If the chunks cover only part of a process, model that part honestly rather than filling gaps.`;

interface IngestBody {
  pass?: 'process' | 'items';
  source?: SourceRef;
  /** Pass 2 only: the process model from pass 1, and its chunks. */
  process?: unknown;
  chunks?: SourceChunk[];
}

function isAllowedOrigin(origin: string | undefined): boolean {
  if (!origin) return false;
  return (
    /^https:\/\/mybluelearning-[a-z0-9-]+\.vercel\.app$/.test(origin) ||
    /^https:\/\/mybluelearning\.vercel\.app$/.test(origin) ||
    origin === 'http://localhost:5173'
  );
}

function applyResponseHeaders(res: VercelResponse, origin: string | undefined): void {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Referrer-Policy', 'no-referrer');
  if (isAllowedOrigin(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin as string);
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
    res.setHeader('Vary', 'Origin');
  }
}

/**
 * Strip control characters and anything credential-shaped from model-authored
 * free text. A hostile or poisoned source document could in principle coax the
 * model into echoing a token back through a `quote` or `why` field.
 */
function scrubText(s: string, maxLen: number): string {
  return s
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/Bearer\s+[\w.\-]+/gi, '[redacted]')
    .replace(/eyJ[\w.\-]{20,}/g, '[redacted]')
    .slice(0, maxLen);
}

/** Chunks sent to the model per call — bounded so the call fits the time budget. */
const MAX_CHUNKS_PER_CALL = 8;
const MAX_CHUNK_CHARS = 12_000;

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const origin = typeof req.headers.origin === 'string' ? req.headers.origin : undefined;
  applyResponseHeaders(res, origin);

  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST, OPTIONS');
    return res.status(405).json({ error: 'method_not_allowed' });
  }

  const requestId = randomUUID();

  const anthropicApiKey = process.env.ANTHROPIC_API_KEY;
  if (!anthropicApiKey) {
    // eslint-disable-next-line no-console
    console.error('[/api/ingest]', requestId, 'ANTHROPIC_API_KEY not configured');
    return res.status(500).json({ error: 'config_error', requestId });
  }

  const contentType = req.headers['content-type'] ?? '';
  if (!contentType.includes('application/json')) {
    return res.status(415).json({ error: 'unsupported_media_type', requestId });
  }

  let user: VerifiedUser;
  try {
    user = await verifyRequestToken(
      typeof req.headers.authorization === 'string' ? req.headers.authorization : undefined,
    );
  } catch (err) {
    if (err instanceof AuthError) {
      return res.status(err.status).json({ error: err.code, requestId });
    }
    // eslint-disable-next-line no-console
    console.error('[/api/ingest]', requestId, 'auth verification error');
    return res.status(401).json({ error: 'unauthorized', requestId });
  }

  const rl = checkRateLimit(user.oid);
  if (!rl.ok) {
    if (rl.retryAfterSec) res.setHeader('Retry-After', String(rl.retryAfterSec));
    return res.status(429).json({ error: 'rate_limited', requestId });
  }

  const body = (req.body ?? {}) as IngestBody;
  if (body.pass !== 'process' && body.pass !== 'items') {
    return res.status(400).json({ error: 'bad_request', requestId });
  }

  // 50s client timeout leaves headroom under the function ceiling so the SDK
  // fails with a typed error rather than being killed mid-call.
  const client = new Anthropic({ apiKey: anthropicApiKey, timeout: 50_000 });

  try {
    if (body.pass === 'process') {
      return await runProcessPass(client, body, res, requestId);
    }
    return res.status(501).json({ error: 'items_pass_not_implemented', requestId });
  } catch (err) {
    if (err instanceof SourceError) {
      return res.status(err.status).json({ error: err.code, detail: err.message, requestId });
    }
    if (err instanceof Anthropic.RateLimitError) {
      return res.status(429).json({ error: 'upstream_rate_limited', requestId });
    }
    if (err instanceof Anthropic.BadRequestError) {
      // eslint-disable-next-line no-console
      console.error('[/api/ingest]', requestId, 'bad upstream request', err.message);
      return res.status(500).json({ error: 'upstream_bad_request', requestId });
    }
    if (err instanceof Anthropic.APIError) {
      // eslint-disable-next-line no-console
      console.error('[/api/ingest]', requestId, 'upstream error', err.status);
      return res.status(502).json({ error: 'upstream_error', requestId });
    }
    // eslint-disable-next-line no-console
    console.error('[/api/ingest]', requestId, 'unhandled', err);
    return res.status(500).json({ error: 'internal_error', requestId });
  }
}

async function runProcessPass(
  client: Anthropic,
  body: IngestBody,
  res: VercelResponse,
  requestId: string,
) {
  const source = body.source;
  if (!source || typeof source.origin !== 'string' || typeof source.title !== 'string') {
    return res.status(400).json({ error: 'bad_request', requestId });
  }

  const sourceId = `src-${randomUUID().slice(0, 8)}`;

  let chunks: SourceChunk[];
  if (source.kind === 'sap-help-page') {
    chunks = await fetchSapHelpPage(source, sourceId);
  } else if (source.kind === 'user-pdf' || source.kind === 'sap-help-pdf') {
    // PDF ingest goes through the model's native document handling rather than
    // client-side text extraction. Not wired up yet — see README.
    return res.status(501).json({ error: 'pdf_ingest_not_implemented', requestId });
  } else {
    return res.status(400).json({ error: 'unsupported_source_kind', requestId });
  }

  const used = chunks.slice(0, MAX_CHUNKS_PER_CALL).map((c) => ({
    ...c,
    text: c.text.slice(0, MAX_CHUNK_CHARS),
  }));

  const chunkBlock = used
    .map(
      (c, i) =>
        `<chunk index="${i}" sourceId="${c.sourceId}" sourceTitle="${escapeAttr(
          source.title,
        )}" locator="${escapeAttr(c.locator)}">\n${c.text}\n</chunk>`,
    )
    .join('\n\n');

  const response = await client.messages
    .stream({
      model: 'claude-opus-5',
      max_tokens: 32_000,
      thinking: { type: 'adaptive' },
      output_config: {
        effort: 'high',
        format: { type: 'json_schema', schema: PROCESS_SCHEMA },
      },
      system: [
        {
          type: 'text',
          text: PROCESS_SYSTEM_PROMPT,
          cache_control: { type: 'ephemeral' },
        },
      ],
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text: `Source document: ${source.title}\n\n${chunkBlock}`,
              cache_control: { type: 'ephemeral' },
            },
            {
              type: 'text',
              text: 'Build the process model as JSON. Quote verbatim; omit anything the chunks do not support.',
            },
          ],
        },
      ],
    })
    .finalMessage();

  const raw = response.content.find((b) => b.type === 'text');
  if (!raw || raw.type !== 'text') {
    return res.status(502).json({ error: 'empty_response', requestId });
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw.text);
  } catch {
    return res.status(502).json({ error: 'unparseable_response', requestId });
  }

  // ---- The citation guard, applied server-side. ----
  const { model: settledProcess, stats } = settleProcessCitations(parsed, used);

  return res.status(200).json({
    process: settledProcess,
    sources: [
      {
        id: sourceId,
        kind: source.kind,
        title: source.title,
        origin: source.origin,
        ingestedAt: new Date().toISOString(),
      },
    ],
    chunks: used,
    verification: stats,
    usage: {
      input_tokens: response.usage.input_tokens,
      output_tokens: response.usage.output_tokens,
      cache_read_input_tokens: response.usage.cache_read_input_tokens,
    },
    requestId,
  });
}

function escapeAttr(s: string): string {
  return s.replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

export interface VerificationStats {
  citationsTotal: number;
  citationsVerified: number;
  failures: Record<string, number>;
}

/**
 * Walk everything the model produced and settle each citation against the
 * chunks. The model's own view of whether a citation is trustworthy is never
 * consulted, because the schema never let it express one.
 */
export function settleProcessCitations(
  parsed: unknown,
  chunks: readonly SourceChunk[],
): { model: unknown; stats: VerificationStats } {
  const stats: VerificationStats = { citationsTotal: 0, citationsVerified: 0, failures: {} };

  function settle(list: unknown): unknown {
    if (!Array.isArray(list)) return [];
    const claimed = list.filter(
      (c): c is ClaimedCitation =>
        Boolean(c) && typeof c === 'object' && typeof (c as ClaimedCitation).quote === 'string',
    );
    const { citations, failures } = settleCitations(claimed, chunks);
    stats.citationsTotal += citations.length;
    stats.citationsVerified += citations.filter((c) => c.verified).length;
    for (const f of failures) stats.failures[f] = (stats.failures[f] ?? 0) + 1;
    return citations.map((c) => ({ ...c, quote: scrubText(c.quote, 2_000) }));
  }

  function settleCollection(items: unknown): unknown[] {
    if (!Array.isArray(items)) return [];
    return items.map((item) => {
      if (!item || typeof item !== 'object') return item;
      const rec = item as Record<string, unknown>;
      return { ...rec, citations: settle(rec.citations) };
    });
  }

  if (!parsed || typeof parsed !== 'object') return { model: parsed, stats };
  const p = parsed as Record<string, unknown>;

  return {
    model: {
      ...p,
      nodes: settleCollection(p.nodes),
      edges: settleCollection(p.edges),
      failureModes: settleCollection(p.failureModes),
    },
    stats,
  };
}
