import type {
  Citation,
  CoursePack,
  FailureMode,
  Item,
  ProcessEdge,
  ProcessModel,
  ProcessNode,
  SourcedClaim,
  SourcedToken,
  Synthesis,
} from './types';

/**
 * Structural validation and the accuracy guard for generated course packs.
 *
 * Course-pack content is model-generated, so this is a trust boundary in the
 * same sense as the customer import in expenses-app: validate shape before use,
 * and never assume a field is present because the schema asked for it.
 *
 * ── What this guard does and does not do ──
 *
 * It enforces exactly one thing, mechanically: content presented as SOURCED
 * must rest on a quote that was actually located in the cited document, and a
 * literal token (T-code, IMG path) must appear verbatim in that document.
 * Anything failing that is dropped rather than shown — a wrong T-code inside a
 * spaced-repetition schedule does not merely fail to teach, it drills the error
 * until it feels true.
 *
 * It does NOT establish that a quote supports the claim printed above it. A
 * genuine sentence can sit beside a fabricated assertion and pass every check
 * here. That gap is structural and no amount of string matching closes it,
 * which is why `Synthesis` is a separate type that is never badged, and why
 * `ContentFlag` puts the domain expert in the loop.
 *
 * An earlier version of this file accepted any citation carrying a boolean
 * flag, without requiring the flag to be true. Combined with a generation
 * schema that forced every field non-empty, it dropped nothing whatsoever from
 * real pipeline output. The `requireFound` checks below are the fix.
 */

export interface ValidationReport {
  /** Content that survived. */
  pack: CoursePack;
  /** One line per dropped element, for surfacing at ingest. */
  dropped: string[];
  /** Problems that make the pack unusable rather than merely smaller. */
  fatal: string[];
}

function isNonEmptyString(v: unknown): v is string {
  return typeof v === 'string' && v.trim().length > 0;
}

/**
 * A citation is structurally usable if it resolves to a declared source and
 * carries a quote. Whether the quote was FOUND is a separate question, asked
 * by the callers that care.
 */
function citationIsWellFormed(c: unknown, knownSourceIds: Set<string>): c is Citation {
  if (!c || typeof c !== 'object') return false;
  const cit = c as Partial<Citation>;
  if (!isNonEmptyString(cit.sourceId) || !knownSourceIds.has(cit.sourceId)) return false;
  if (!isNonEmptyString(cit.locator)) return false;
  if (!isNonEmptyString(cit.quote)) return false;
  // The flag must be explicitly present. Defaulting a missing flag to false
  // would be safe; defaulting it to true would silently launder unchecked
  // content, so an absent flag is treated as malformed instead.
  if (typeof cit.quoteFound !== 'boolean') return false;
  return true;
}

function wellFormedCitations(raw: unknown, knownSourceIds: Set<string>): Citation[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((c): c is Citation => citationIsWellFormed(c, knownSourceIds));
}

/**
 * Validate a claim the pack presents as sourced.
 *
 * Returns null when nothing supports it. `requireFound` is what makes the guard
 * bite: a claim whose every citation failed quote-matching is a claim with no
 * evidence, however well-formed its citation objects are.
 */
function usableSourcedClaim(
  raw: unknown,
  knownSourceIds: Set<string>,
): SourcedClaim | null {
  if (!raw || typeof raw !== 'object') return null;
  const claim = raw as Partial<SourcedClaim>;
  if (!isNonEmptyString(claim.text)) return null;
  const found = wellFormedCitations(claim.citations, knownSourceIds).filter(
    (c) => c.quoteFound,
  );
  if (found.length === 0) return null;
  return { text: claim.text, citations: found };
}

/**
 * Validate synthesis.
 *
 * Never dropped for want of a found quote — that is the difference between this
 * and a sourced claim, and dropping it would strip the app of the only content
 * that teaches understanding. Citations that failed matching ARE removed from
 * `basedOn`, because an unfound quote is not support for a judgement; it is a
 * fabrication that would mislead a reader trying to check the reasoning.
 */
function usableSynthesis(raw: unknown, knownSourceIds: Set<string>): Synthesis | null {
  if (!raw || typeof raw !== 'object') return null;
  const syn = raw as Partial<Synthesis>;
  if (!isNonEmptyString(syn.text)) return null;
  const basedOn = wellFormedCitations(syn.basedOn, knownSourceIds).filter(
    (c) => c.quoteFound,
  );
  // A synthesis claiming the source states it outright, with nothing found to
  // back that, is demoted rather than trusted.
  const origin = syn.origin === 'stated' && basedOn.length > 0 ? 'stated' : 'inferred';
  return { text: syn.text, origin, basedOn };
}

/**
 * Keep only tokens found verbatim in the source.
 *
 * This is the check with the most signal in the whole codebase and it was
 * missing entirely. A transaction code is a literal string, so "does it appear
 * in the document" is a far stronger test than prose quote-matching — and a
 * plausible fictional T-code is the single most damaging thing the pipeline can
 * emit.
 */
function usableTokens(raw: unknown, dropped: string[], label: string): SourcedToken[] {
  if (!Array.isArray(raw)) return [];
  const kept: SourcedToken[] = [];
  for (const t of raw) {
    if (!t || typeof t !== 'object') continue;
    const tok = t as Partial<SourcedToken>;
    if (!isNonEmptyString(tok.value)) continue;
    if (tok.foundInSource !== true) {
      dropped.push(`${label}: "${tok.value}" was not found in the source — dropped`);
      continue;
    }
    kept.push({ value: tok.value, foundInSource: true, citation: tok.citation });
  }
  return kept;
}

function usableToken(
  raw: unknown,
  dropped: string[],
  label: string,
): SourcedToken | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const tok = raw as Partial<SourcedToken>;
  if (!isNonEmptyString(tok.value)) return undefined;
  if (tok.foundInSource !== true) {
    dropped.push(`${label}: "${tok.value}" was not found in the source — dropped`);
    return undefined;
  }
  return { value: tok.value, foundInSource: true, citation: tok.citation };
}

export function validateCoursePack(raw: unknown): ValidationReport | null {
  if (!raw || typeof raw !== 'object') return null;
  const pack = raw as Partial<CoursePack>;
  const dropped: string[] = [];
  const fatal: string[] = [];

  if (!Array.isArray(pack.sources) || pack.sources.length === 0) {
    fatal.push('Pack declares no sources, so nothing in it can be checked.');
    return { pack: raw as CoursePack, dropped, fatal };
  }
  const knownSourceIds = new Set(
    pack.sources.filter((s) => isNonEmptyString(s?.id)).map((s) => s.id),
  );

  const proc = pack.process as Partial<ProcessModel> | undefined;
  if (!proc || !Array.isArray(proc.nodes)) {
    fatal.push('Pack has no process model.');
    return { pack: raw as CoursePack, dropped, fatal };
  }

  // ── nodes ──
  const nodes: ProcessNode[] = [];
  for (const n of proc.nodes) {
    if (!n || typeof n !== 'object') continue;
    const node = n as Partial<ProcessNode>;
    const label = isNonEmptyString(node.label) ? node.label : '(unlabelled)';

    if (!isNonEmptyString(node.id)) {
      dropped.push(`node "${label}": no id`);
      continue;
    }
    const what = usableSourcedClaim(node.what, knownSourceIds);
    if (!what) {
      dropped.push(`node "${label}": its definition rests on no quote that was found in the source`);
      continue;
    }
    const why = usableSynthesis(node.why, knownSourceIds);
    const breaksIf = usableSynthesis(node.breaksIf, knownSourceIds);
    // A node that cannot say why it exists teaches sequence without
    // understanding, which is the failure this whole app is built to avoid.
    if (!why || !breaksIf) {
      dropped.push(`node "${label}": missing why or breaksIf`);
      continue;
    }

    nodes.push({
      id: node.id,
      label,
      kind: node.kind ?? 'step',
      what,
      why,
      breaksIf,
      tcodes: usableTokens(node.tcodes, dropped, `node "${label}" T-code`),
      configPath: usableToken(node.configPath, dropped, `node "${label}" config path`),
      videoUrl: node.videoUrl,
    });
  }
  const nodeIds = new Set(nodes.map((n) => n.id));

  if (nodes.length === 0) {
    fatal.push('No nodes survived validation.');
    return { pack: raw as CoursePack, dropped, fatal };
  }

  // ── edges ── an edge to a dropped node would render as a dangling arrow
  const edges: ProcessEdge[] = [];
  for (const e of Array.isArray(proc.edges) ? proc.edges : []) {
    const edge = e as Partial<ProcessEdge>;
    if (!isNonEmptyString(edge.id) || !isNonEmptyString(edge.from) || !isNonEmptyString(edge.to)) {
      dropped.push('edge: malformed');
      continue;
    }
    if (!nodeIds.has(edge.from) || !nodeIds.has(edge.to)) {
      dropped.push(`edge "${edge.id}": references a node that did not survive validation`);
      continue;
    }
    const label = usableSourcedClaim(edge.label, knownSourceIds);
    if (!label) {
      dropped.push(`edge "${edge.id}": the step ordering it asserts is not supported by a found quote`);
      continue;
    }
    edges.push({ id: edge.id, from: edge.from, to: edge.to, label, condition: edge.condition });
  }

  // ── failure modes ──
  const failureModes: FailureMode[] = [];
  for (const f of Array.isArray(proc.failureModes) ? proc.failureModes : []) {
    const fm = f as Partial<FailureMode>;
    if (!isNonEmptyString(fm.id)) {
      dropped.push('failure mode: malformed');
      continue;
    }
    const symptom = usableSourcedClaim(fm.symptom, knownSourceIds);
    const resolution = usableSourcedClaim(fm.resolution, knownSourceIds);
    const cause = usableSynthesis(fm.cause, knownSourceIds);
    if (!symptom || !resolution || !cause) {
      dropped.push(`failure mode "${fm.id}": symptom or resolution is not supported by a found quote`);
      continue;
    }
    failureModes.push({
      id: fm.id,
      symptom,
      cause,
      resolution,
      nodeIds: (Array.isArray(fm.nodeIds) ? fm.nodeIds : []).filter((id) => nodeIds.has(id)),
    });
  }

  // ── happy path ──
  const happyPath = (Array.isArray(proc.happyPath) ? proc.happyPath : []).filter(
    (id): id is string => isNonEmptyString(id) && nodeIds.has(id),
  );
  if (happyPath.length < 2) {
    fatal.push('Happy path has fewer than two surviving steps — nothing to walk through or sequence.');
  }
  /**
   * Consecutive steps on the happy path must be joined by a real edge.
   *
   * Without this, a path can assert an ordering the edges never claimed and the
   * Map draws a connector between two nodes with nothing between them — which
   * is precisely how a false step ordering got into this codebase and into a
   * Sequence-it drill built from it.
   */
  for (let i = 0; i < happyPath.length - 1; i += 1) {
    const from = happyPath[i];
    const to = happyPath[i + 1];
    if (!edges.some((e) => e.from === from && e.to === to)) {
      fatal.push(
        `Happy path claims "${from}" is followed by "${to}", but no edge asserts that ordering.`,
      );
    }
  }

  // ── items ──
  const items: Item[] = [];
  for (const i of Array.isArray(pack.items) ? pack.items : []) {
    const item = i as Partial<Item>;
    if (!isNonEmptyString(item.id) || !isNonEmptyString(item.kind)) {
      dropped.push('item: malformed');
      continue;
    }
    // An item that drills a node we dropped would ask about content we cannot
    // show or check.
    const refs = Array.isArray(item.nodeIds) ? item.nodeIds : [];
    const liveRefs = refs.filter((id) => nodeIds.has(id));
    if (refs.length > 0 && liveRefs.length === 0) {
      dropped.push(`item "${item.id}" (${item.kind}): every node it drills was dropped`);
      continue;
    }
    items.push({
      ...(item as Item),
      nodeIds: liveRefs,
      basedOn: wellFormedCitations(item.basedOn, knownSourceIds).filter((c) => c.quoteFound),
    });
  }

  return {
    pack: {
      id: isNonEmptyString(pack.id) ? pack.id : crypto.randomUUID(),
      schemaVersion: 2,
      createdAt: isNonEmptyString(pack.createdAt) ? pack.createdAt : new Date().toISOString(),
      sources: pack.sources,
      process: {
        id: isNonEmptyString(proc.id) ? proc.id : crypto.randomUUID(),
        title: isNonEmptyString(proc.title) ? proc.title : 'Untitled process',
        module: isNonEmptyString(proc.module) ? proc.module : 'Unknown module',
        summary: isNonEmptyString(proc.summary) ? proc.summary : '',
        nodes,
        edges,
        failureModes,
        happyPath,
      },
      items,
    },
    dropped,
    fatal,
  };
}
