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
import { settleCitations, settleTokens } from './_verifyQuotes.js';
import type { ClaimedCitation, SettledToken } from './_verifyQuotes.js';

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
 * ── Sourced claims vs synthesis ──
 *
 * An earlier version of this endpoint asked for one `citations` array per node
 * covering every field on it, and told the model to omit any node whose `why`
 * it could not take from the source. That instruction was incoherent with the
 * job: technical documentation states what a system does and almost never why.
 * Obeying it literally produces empty models; disobeying it produces inference
 * wearing a citation that supports only the neighbouring `what`.
 *
 * So the schema now distinguishes them. `what`, edge labels, failure symptoms
 * and resolutions are SourcedClaims that must quote the document. `why` and
 * `breaksIf` are Synthesis: the model's reasoning, explicitly labelled, with
 * the passages it drew on. Inference is expected there and banned absolutely
 * for literal tokens, which are checked character by character.
 *
 * Model notes:
 * - Opus 5. This is not the receipt-extraction job the expenses app does — it
 *   is reading technical documentation and building a causal model of a
 *   process. That is the reasoning tier.
 * - Adaptive thinking. It is on by default on Opus 5, and disabling it also
 *   risks tool-call-shaped text leaking into the visible response.
 * - Streaming with `.finalMessage()` because the process model can be a large
 *   JSON payload and a non-streaming request that size risks an HTTP timeout.
 * - The source chunks are cached: pass 2 sends the same chunks as pass 1, and
 *   a retry re-sends them again.
 * - Structured outputs and Anthropic's native citations are mutually exclusive
 *   (the combination is a 400), which is one more reason citations here are
 *   checked mechanically against the chunk text instead.
 */

/** Citation shape the model produces. Note what is absent: `quoteFound`. */
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

/** Something the documentation states. Must quote it. */
const SOURCED_CLAIM_SCHEMA = {
  type: 'object',
  properties: {
    text: { type: 'string', description: 'The claim, in your own concise wording.' },
    citations: { type: 'array', items: CITATION_SCHEMA, minItems: 1 },
  },
  required: ['text', 'citations'],
  additionalProperties: false,
} as const;

/** Your reasoning about the process. Inference is expected here. */
const SYNTHESIS_SCHEMA = {
  type: 'object',
  properties: {
    text: { type: 'string' },
    origin: {
      type: 'string',
      enum: ['stated', 'inferred'],
      description:
        'Use "stated" ONLY when the source says this outright and your quote carries the reasoning itself. Otherwise "inferred". Most process reasoning is inferred; saying so is correct, not a weakness.',
    },
    basedOn: {
      type: 'array',
      items: CITATION_SCHEMA,
      description:
        'Passages your reasoning draws on, so a reader can judge it. May be empty for pure inference.',
    },
  },
  required: ['text', 'origin', 'basedOn'],
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
          what: SOURCED_CLAIM_SCHEMA,
          why: SYNTHESIS_SCHEMA,
          breaksIf: SYNTHESIS_SCHEMA,
          tcodes: {
            type: 'array',
            items: { type: 'string' },
            description:
              'Transaction codes that appear VERBATIM in the chunk text. Never from memory — these are checked literally and dropped if absent.',
          },
          configPath: {
            anyOf: [{ type: 'string' }, { type: 'null' }],
            description:
              'Customizing / IMG path, copied verbatim from the chunk text. Null if the chunks do not give one.',
          },
        },
        required: ['id', 'label', 'kind', 'what', 'why', 'breaksIf', 'tcodes'],
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
          label: SOURCED_CLAIM_SCHEMA,
          condition: { anyOf: [{ type: 'string' }, { type: 'null' }] },
        },
        required: ['id', 'from', 'to', 'label'],
        additionalProperties: false,
      },
    },
    failureModes: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          symptom: SOURCED_CLAIM_SCHEMA,
          cause: SYNTHESIS_SCHEMA,
          nodeIds: { type: 'array', items: { type: 'string' } },
          resolution: SOURCED_CLAIM_SCHEMA,
        },
        required: ['id', 'symptom', 'cause', 'nodeIds', 'resolution'],
        additionalProperties: false,
      },
    },
    happyPath: {
      type: 'array',
      items: { type: 'string' },
      description:
        'Node ids of the canonical path, in order. ONLY genuinely sequential steps. A decision made WITHIN another step is not a later step — leave it off the path and connect it with an edge instead. Every consecutive pair here must have an edge asserting that ordering, or the model is rejected.',
    },
  },
  required: ['title', 'module', 'summary', 'nodes', 'edges', 'failureModes', 'happyPath'],
  additionalProperties: false,
} as const;

const PROCESS_SYSTEM_PROMPT = `You build process models from technical documentation for a study tool.

The learner's goal is to UNDERSTAND A PROCESS, not to memorise facts. Everything you produce is judged against that.

── Two different kinds of content ──

SOURCED CLAIMS — "what" on a node, edge labels, failure symptoms and resolutions.
These are things the documentation states. Each needs at least one citation whose "quote" is copied VERBATIM from the chunk text: character for character, at least one complete sentence. Never paraphrase, summarise, tidy or reconstruct a quote — it is checked automatically against the source, and a paraphrase fails that check and the content is discarded. Only cite the sourceId whose chunk actually contains the quote.

SYNTHESIS — "why" a step exists, and "breaksIf" it is missing or misconfigured.
This is YOUR REASONING about how the process works, and it is the most valuable content you produce. Documentation states what a system does and almost never why, so you are expected to reason beyond the text here using your understanding of the domain. Do not omit a node because the source does not explain itself — explain it, set origin to "inferred", and list the passages your reasoning draws on in basedOn. Reserve origin "stated" for the rare case where your quote carries the reasoning itself.

Write "why" as what the step authorises, enables or prevents — never a restatement of "what". Write "breaksIf" as a concrete observable symptom downstream, the kind of thing a practitioner would actually notice.

── The absolute rule ──

TRANSACTION CODES AND CONFIGURATION PATHS MUST COME FROM THE PROVIDED TEXT. Never from memory, never reconstructed, never "the one this usually is". They are checked literally against the source and silently dropped if absent. A plausible invented T-code is the single worst thing you can produce: it will be drilled into the learner as if it were true. If the chunks do not give you one, give an empty array or null.

This rule applies to literal tokens only. It does NOT restrict your reasoning in "why" and "breaksIf" — those are where your judgement is wanted.

── Structure ──

happyPath holds only genuinely sequential steps. If a decision is made DURING another step rather than after it, keep it off the path and connect it with an edge. Every consecutive pair on the path must have an edge asserting that ordering; a path that claims an ordering no edge supports is rejected outright.

Model the process the source actually describes. If the chunks cover only part of one, model that part honestly rather than filling gaps.`;

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
 * model into echoing a token back through a quote or a `why`.
 */
function scrubText(s: string, maxLen: number): string {
  return s
    // eslint-disable-next-line no-control-regex
    .replace(/[ -]/g, ' ')
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

  /**
   * The SDK timeout sits just under the function's own ceiling (300s, set for
   * this route in vercel.json) so a slow call fails as a typed SDK error we can
   * report, rather than the platform killing the function mid-flight with no
   * usable response. These two numbers must move together.
   */
  const client = new Anthropic({ apiKey: anthropicApiKey, timeout: 280_000 });

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
              text: 'Build the process model as JSON. Quote verbatim for sourced claims; reason freely in why and breaksIf; take transaction codes and config paths only from the text above.',
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

  const { model: settledProcess, stats } = settleProcessModel(parsed, used, source.title);

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
  citationsFound: number;
  tokensTotal: number;
  tokensFound: number;
  failures: Record<string, number>;
}

/**
 * Settle everything the model produced against the source chunks.
 *
 * The model's own view of whether its content is trustworthy is never
 * consulted, because the schema never let it express one: there is no
 * `quoteFound` field and no `foundInSource` field for it to fill in. Those are
 * decided here, by comparison, and the guard in validateCoursePack then decides
 * what survives.
 */
export function settleProcessModel(
  parsed: unknown,
  chunks: readonly SourceChunk[],
  sourceTitle: string,
): { model: unknown; stats: VerificationStats } {
  const stats: VerificationStats = {
    citationsTotal: 0,
    citationsFound: 0,
    tokensTotal: 0,
    tokensFound: 0,
    failures: {},
  };

  function settleCitationArray(list: unknown) {
    if (!Array.isArray(list)) return [];
    const claimed = list.filter(
      (c): c is ClaimedCitation =>
        Boolean(c) && typeof c === 'object' && typeof (c as ClaimedCitation).quote === 'string',
    );
    const { citations, failures } = settleCitations(claimed, chunks);
    stats.citationsTotal += citations.length;
    stats.citationsFound += citations.filter((c) => c.quoteFound).length;
    for (const f of failures) stats.failures[f] = (stats.failures[f] ?? 0) + 1;
    return citations.map((c) => ({ ...c, quote: scrubText(c.quote, 2_000) }));
  }

  /** `{ text, citations }` — the citations decide whether the claim survives. */
  function settleClaim(raw: unknown) {
    if (!raw || typeof raw !== 'object') return raw;
    const claim = raw as Record<string, unknown>;
    return {
      ...claim,
      text: typeof claim.text === 'string' ? scrubText(claim.text, 2_000) : claim.text,
      citations: settleCitationArray(claim.citations),
    };
  }

  /** `{ text, origin, basedOn }` — kept regardless, but its support is checked. */
  function settleSynthesis(raw: unknown) {
    if (!raw || typeof raw !== 'object') return raw;
    const syn = raw as Record<string, unknown>;
    return {
      ...syn,
      text: typeof syn.text === 'string' ? scrubText(syn.text, 2_000) : syn.text,
      basedOn: settleCitationArray(syn.basedOn),
    };
  }

  /** Literal tokens: checked character by character, never trusted from memory. */
  function settleTokenList(raw: unknown): SettledToken[] {
    if (!Array.isArray(raw)) return [];
    const claimed = raw
      .filter((v): v is string => typeof v === 'string' && v.trim().length > 0)
      .map((value) => ({ value }));
    const settled = settleTokens(claimed, chunks, sourceTitle);
    stats.tokensTotal += settled.length;
    stats.tokensFound += settled.filter((t) => t.foundInSource).length;
    return settled;
  }

  function settleSingleToken(raw: unknown): SettledToken | undefined {
    if (typeof raw !== 'string' || raw.trim().length === 0) return undefined;
    const [settled] = settleTokens([{ value: raw }], chunks, sourceTitle);
    stats.tokensTotal += 1;
    if (settled?.foundInSource) stats.tokensFound += 1;
    return settled;
  }

  if (!parsed || typeof parsed !== 'object') return { model: parsed, stats };
  const p = parsed as Record<string, unknown>;

  const nodes = (Array.isArray(p.nodes) ? p.nodes : []).map((n) => {
    if (!n || typeof n !== 'object') return n;
    const node = n as Record<string, unknown>;
    return {
      ...node,
      what: settleClaim(node.what),
      why: settleSynthesis(node.why),
      breaksIf: settleSynthesis(node.breaksIf),
      tcodes: settleTokenList(node.tcodes),
      configPath: settleSingleToken(node.configPath),
    };
  });

  const edges = (Array.isArray(p.edges) ? p.edges : []).map((e) => {
    if (!e || typeof e !== 'object') return e;
    const edge = e as Record<string, unknown>;
    return { ...edge, label: settleClaim(edge.label) };
  });

  const failureModes = (Array.isArray(p.failureModes) ? p.failureModes : []).map((f) => {
    if (!f || typeof f !== 'object') return f;
    const fm = f as Record<string, unknown>;
    return {
      ...fm,
      symptom: settleClaim(fm.symptom),
      cause: settleSynthesis(fm.cause),
      resolution: settleClaim(fm.resolution),
    };
  });

  return { model: { ...p, nodes, edges, failureModes }, stats };
}
