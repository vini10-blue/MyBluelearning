import type {
  Citation,
  CoursePack,
  FailureMode,
  Item,
  ProcessEdge,
  ProcessModel,
  ProcessNode,
} from './types';

/**
 * Structural validation and the citation guard for generated course packs.
 *
 * Course-pack content is model-generated, so this is a trust boundary in the
 * same sense as the customer import in expenses-app: validate shape before
 * use, and never assume a field is present because the schema asked for it.
 *
 * The guard is deliberately destructive — uncited content is DROPPED, not
 * flagged for later review. A wrong T-code inside a spaced-repetition schedule
 * does not merely fail to teach; it drills the error until it feels true. A
 * smaller verified pack beats a larger unverified one.
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
 * A citation counts only if it resolves. A model will happily invent a
 * plausible source id, so membership in the pack's own source list is checked
 * rather than assumed.
 */
function citationIsUsable(c: unknown, knownSourceIds: Set<string>): c is Citation {
  if (!c || typeof c !== 'object') return false;
  const cit = c as Partial<Citation>;
  if (!isNonEmptyString(cit.sourceId) || !knownSourceIds.has(cit.sourceId)) return false;
  if (!isNonEmptyString(cit.locator)) return false;
  // The quote is what makes a citation checkable rather than decorative.
  if (!isNonEmptyString(cit.quote)) return false;
  // `verified` must be explicitly present. Defaulting a missing flag to false
  // would be safe; defaulting it to true silently launders unchecked content,
  // so an absent flag is treated as a malformed citation instead.
  if (typeof cit.verified !== 'boolean') return false;
  return true;
}

function usableCitations(raw: unknown, knownSourceIds: Set<string>): Citation[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((c): c is Citation => citationIsUsable(c, knownSourceIds));
}

function nodeIsUsable(n: unknown, knownSourceIds: Set<string>): n is ProcessNode {
  if (!n || typeof n !== 'object') return false;
  const node = n as Partial<ProcessNode>;
  if (!isNonEmptyString(node.id) || !isNonEmptyString(node.label)) return false;
  // what/why/breaksIf are all required. A node that cannot say why it exists
  // teaches sequence without understanding, which is the failure mode this
  // whole app is built to avoid.
  if (!isNonEmptyString(node.what)) return false;
  if (!isNonEmptyString(node.why)) return false;
  if (!isNonEmptyString(node.breaksIf)) return false;
  return usableCitations(node.citations, knownSourceIds).length > 0;
}

export function validateCoursePack(raw: unknown): ValidationReport | null {
  if (!raw || typeof raw !== 'object') return null;
  const pack = raw as Partial<CoursePack>;
  const dropped: string[] = [];
  const fatal: string[] = [];

  if (!Array.isArray(pack.sources) || pack.sources.length === 0) {
    fatal.push('Pack declares no sources, so nothing in it can be verified.');
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
    if (nodeIsUsable(n, knownSourceIds)) {
      nodes.push({ ...n, citations: usableCitations(n.citations, knownSourceIds) });
    } else {
      const label =
        n && typeof n === 'object' && isNonEmptyString((n as ProcessNode).label)
          ? (n as ProcessNode).label
          : '(unlabelled)';
      dropped.push(`node "${label}": missing a usable citation or a required what/why/breaksIf`);
    }
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
    const cits = usableCitations(edge.citations, knownSourceIds);
    if (cits.length === 0) {
      dropped.push(`edge "${edge.id}": no usable citation`);
      continue;
    }
    edges.push({ ...(edge as ProcessEdge), citations: cits });
  }

  // ── failure modes ──
  const failureModes: FailureMode[] = [];
  for (const f of Array.isArray(proc.failureModes) ? proc.failureModes : []) {
    const fm = f as Partial<FailureMode>;
    if (!isNonEmptyString(fm.symptom) || !isNonEmptyString(fm.cause)) {
      dropped.push('failure mode: malformed');
      continue;
    }
    const cits = usableCitations(fm.citations, knownSourceIds);
    if (cits.length === 0) {
      dropped.push(`failure mode "${fm.symptom}": no usable citation`);
      continue;
    }
    failureModes.push({
      ...(fm as FailureMode),
      nodeIds: (Array.isArray(fm.nodeIds) ? fm.nodeIds : []).filter((id) => nodeIds.has(id)),
      citations: cits,
    });
  }

  // ── happy path ── drop steps whose node is gone rather than the whole path
  const happyPath = (Array.isArray(proc.happyPath) ? proc.happyPath : []).filter(
    (id): id is string => isNonEmptyString(id) && nodeIds.has(id),
  );
  if (happyPath.length < 2) {
    fatal.push('Happy path has fewer than two surviving steps — nothing to walk through or sequence.');
  }

  // ── items ──
  const items: Item[] = [];
  for (const i of Array.isArray(pack.items) ? pack.items : []) {
    const item = i as Partial<Item>;
    if (!isNonEmptyString(item.id) || !isNonEmptyString(item.kind)) {
      dropped.push('item: malformed');
      continue;
    }
    const cits = usableCitations(item.citations, knownSourceIds);
    if (cits.length === 0) {
      dropped.push(`item "${item.id}" (${item.kind}): no usable citation — rejected`);
      continue;
    }
    // An item that drills a node we dropped would ask about content we cannot
    // show or verify.
    const refs = Array.isArray(item.nodeIds) ? item.nodeIds : [];
    const liveRefs = refs.filter((id) => nodeIds.has(id));
    if (refs.length > 0 && liveRefs.length === 0) {
      dropped.push(`item "${item.id}" (${item.kind}): every node it drills was dropped`);
      continue;
    }
    items.push({ ...(item as Item), nodeIds: liveRefs, citations: cits });
  }

  return {
    pack: {
      id: isNonEmptyString(pack.id) ? pack.id : crypto.randomUUID(),
      schemaVersion: 1,
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
