/**
 * The domain model for MyBlueLearning.
 *
 * Everything in the app is generated from a ProcessModel: the Map renders its
 * graph, the Walkthrough narrates a path through it, every drill is generated
 * against its nodes and edges, and Explain grades free text against the source
 * those nodes cite.
 *
 * ── The distinction this model is built around ──
 *
 * An earlier version of this file treated every field on a node as one kind of
 * thing, with a single `citations` array covering all of them. That was a
 * category error, and it produced exactly the artifact the accuracy guard was
 * meant to prevent: a `why` written from the model's own knowledge, sitting
 * under a citation that supported only the neighbouring `what`, wearing a
 * "verified" badge.
 *
 * Two epistemically different kinds of content live on a node:
 *
 *   SOURCED CLAIMS  — what the documentation states. Definitions, transaction
 *                     codes, configuration paths, the order of steps. These are
 *                     checkable, so they must be checked.
 *
 *   SYNTHESIS       — why a step exists, what breaks without it, why one config
 *                     choice beats another. Technical documentation states what
 *                     a system does and rarely why. This content is Claude's
 *                     reading of the process, and pretending otherwise is worse
 *                     than admitting it: an inference wearing a verified badge
 *                     is more dangerous than an openly unsourced claim, because
 *                     it stops the reader thinking.
 *
 * Synthesis is still the most valuable content in the app — understanding a
 * process IS knowing why its steps exist. It is kept, labelled, shown with the
 * passages it draws on, and never badged. The learner is an SAP consultant; he
 * is a better judge of a `why` than any mechanical check, which is what
 * `ContentFlag` exists for.
 */

/**
 * A pointer back to source text.
 *
 * `quoteFound` is named for exactly what it measures. It was called `verified`,
 * which overclaimed: finding a string in a document proves the string exists,
 * not that it supports the claim printed above it. A genuine quote can sit
 * beside a fabricated assertion and the check would still pass.
 *
 * The flag is set server-side by mechanical comparison against the source
 * chunk. The generation schema has no field for it, so the model cannot assert
 * its own trustworthiness.
 */
export interface Citation {
  /** Id of the SourceDocument this came from. */
  sourceId: string;
  /** Human-readable source name, shown in the UI. */
  sourceTitle: string;
  /** Where in the source: page number, section heading, anchor. */
  locator: string;
  /** Deep link to the exact passage, when the source has one. */
  url?: string;
  /**
   * The verbatim supporting sentence(s). Shown on tap so a claim can be checked
   * without leaving the app, and used as reference text when Explain grades an
   * answer.
   */
  quote: string;
  /**
   * Set by the server: this quote was located, character for character (after
   * normalising copying artifacts), in the cited source chunk.
   *
   * False means the quote could not be found — a paraphrase, a fabrication, or
   * text attributed to the wrong document.
   */
  quoteFound: boolean;
}

/**
 * A claim the source actually states, with the citations that carry it.
 *
 * The guard drops a sourced claim whose citations are all `quoteFound: false`.
 * That is the point of separating this type from `Synthesis`: here, failing to
 * find the quote means the claim is unsupported.
 */
export interface SourcedClaim {
  text: string;
  citations: Citation[];
}

/**
 * Claude's reasoning about the process — the `why` and the `breaksIf`.
 *
 * Deliberately NOT a SourcedClaim. `basedOn` holds the passages the reasoning
 * draws on so the reader can judge the inference; it is support for a
 * judgement, not proof of a fact, and the UI must render it in a different
 * register from sourced content. Synthesis is never dropped for lacking a found
 * quote — dropping it would empty the app of the only content that teaches
 * understanding — but it is also never presented as sourced.
 */
export interface Synthesis {
  text: string;
  /**
   * Whether the source says this outright, or Claude inferred it.
   *
   * `stated` is rare in vendor documentation and should be treated as the
   * exception. When the model claims `stated`, the cited quote is expected to
   * carry the reasoning itself, not merely the surrounding fact.
   */
  origin: 'stated' | 'inferred';
  /** Passages the reasoning rests on. May be empty for pure inference. */
  basedOn: Citation[];
}

/**
 * A literal token from the documentation: a transaction code, an IMG path, a
 * table or object name.
 *
 * These get their own type because they are the highest-risk content in the app
 * and the easiest to check. A model will readily produce a plausible,
 * well-formed, entirely fictional T-code, and under spaced repetition that
 * error is drilled until it feels true. Unlike prose, these are literal
 * strings: a substring check against the source is more reliable here than any
 * amount of quote matching.
 */
export interface SourcedToken {
  value: string;
  /**
   * Set by the server: this exact string appears in the cited source chunk.
   * False means it must not be shown as fact.
   */
  foundInSource: boolean;
  citation?: Citation;
}

/** What kind of thing a node represents in the process. */
export type NodeKind =
  /** An action someone or something performs ("Post goods receipt"). */
  | 'step'
  /** A business document ("Inbound delivery"). */
  | 'document'
  /** A master-data or warehouse object ("Storage bin", "Handling unit"). */
  | 'object'
  /** A branch point ("Is the product batch-managed?"). */
  | 'decision'
  /** A system boundary ("S/4HANA core", "Decentralized EWM"). */
  | 'system';

export interface ProcessNode {
  id: string;
  /** Short label shown on the map. */
  label: string;
  kind: NodeKind;
  /** What this is — the definition. Sourced. */
  what: SourcedClaim;
  /**
   * Why this step exists in the process. Synthesis: this is what separates
   * knowing the sequence from knowing the process, and it is almost never
   * stated outright in vendor documentation.
   */
  why: Synthesis;
  /**
   * What breaks downstream if this is skipped, misconfigured or wrong.
   * Synthesis. Drives Sequence-it feedback and Break-it scenarios.
   */
  breaksIf: Synthesis;
  /** Transaction codes, each checked literally against the source. */
  tcodes: SourcedToken[];
  /** Customizing / IMG path, when this node is configuration-relevant. */
  configPath?: SourcedToken;
  /**
   * Curated SAP screen recording showing this step in the real UI. Not
   * generated — a real published SAP video mapped onto the node. Covers what a
   * diagram handles worse than a recording: recognising the actual RF or Fiori
   * screen.
   */
  videoUrl?: string;
}

export interface ProcessEdge {
  id: string;
  /** Source node id. */
  from: string;
  /** Target node id. */
  to: string;
  /**
   * What flows, or what triggers the next step. Sourced: the ORDER of a
   * process is one of the few things documentation does state directly.
   */
  label: SourcedClaim;
  /** For edges leaving a decision node: the branch condition. */
  condition?: string;
}

/**
 * A known way the process goes wrong — raw material for Break-it drills, and
 * the closest thing in the model to the exam's own scenario format.
 *
 * `symptom` and `resolution` are sourced where documentation describes them;
 * `cause` is usually synthesis, because docs describe correct operation far
 * more often than they diagnose failure.
 */
export interface FailureMode {
  id: string;
  /** What the learner observes ("Warehouse task is not created after GR"). */
  symptom: SourcedClaim;
  cause: Synthesis;
  /** Node ids this failure touches. */
  nodeIds: string[];
  resolution: SourcedClaim;
}

export interface ProcessModel {
  id: string;
  /** "Inbound: goods receipt to putaway" */
  title: string;
  /** "SAP EWM" */
  module: string;
  /** One-paragraph orientation, shown above the map. */
  summary: string;
  nodes: ProcessNode[];
  edges: ProcessEdge[];
  failureModes: FailureMode[];
  /**
   * Node ids forming the canonical linear path, in order. The Walkthrough
   * narrates this and Sequence-it drills it.
   *
   * Only steps that genuinely happen in sequence belong here. A decision made
   * *within* another step — bin determination happens as part of warehouse-task
   * creation, not after it — is a branch off the spine, reachable through an
   * edge. Putting it on the path teaches a false ordering, and a Sequence-it
   * drill built from that path drills the falsehood. This model previously got
   * that exact case wrong.
   */
  happyPath: string[];
}

/* ────────────────────────────── items ────────────────────────────── */

export type ItemKind =
  | 'sequence'
  | 'trace'
  | 'break'
  | 'configure'
  | 'explain'
  | 'recall';

interface ItemBase {
  id: string;
  kind: ItemKind;
  /** Node ids this item exercises — used to interleave and to target review. */
  nodeIds: string[];
  /** Passages behind the item. Support for review, not proof of the answer. */
  basedOn: Citation[];
}

/**
 * A multiple-response question.
 *
 * `correctIndices` rather than a single index because SAP certification is
 * heavily multi-select ("choose 2 correct answers"), and the claim that
 * Break-it and Configure-it mirror the exam's format collapses if the model
 * cannot represent more than one right answer.
 *
 * Note what no mechanical check can reach: which indices are correct is prose
 * judgement by the generating model. It is the highest-stakes field in the app
 * and the only real defence is the learner flagging it.
 */
export interface Choices {
  options: string[];
  /** Indices of every correct option. Length 1 is a single-answer question. */
  correctIndices: number[];
  /**
   * Why each option is right or wrong — one per option, shown after answering.
   * Synthesis: the model's reasoning, not quoted documentation.
   */
  rationales: string[];
  /**
   * Whether the learner is told how many answers are correct. SAP states the
   * count, so hiding it makes the question harder than the real exam.
   */
  revealCount: boolean;
}

/** Put the process steps in the right order. */
export interface SequenceItem extends ItemBase {
  kind: 'sequence';
  prompt: string;
  /** Node ids in correct order. */
  correctOrder: string[];
  /**
   * Per-node consequence text: what breaks downstream when this step lands out
   * of place. Feedback reveals the consequence rather than marking a red X.
   */
  consequences: Record<string, string>;
}

/** Given a document or object, what is created next and posted where. */
export interface TraceItem extends ItemBase {
  kind: 'trace';
  /** The starting document/object and its state. */
  given: string;
  question: string;
  choices: Choices;
}

/** Diagnose a failure. Branching, with consequences visible at each choice. */
export interface BreakItem extends ItemBase {
  kind: 'break';
  /** The situation as the learner would encounter it. */
  scenario: string;
  steps: BreakStep[];
}

export interface BreakStep {
  question: string;
  choices: Choices;
  /** What the learner observes after choosing each option. */
  outcomes: string[];
}

/** Business requirement in, configuration path out. Mirrors the exam format. */
export interface ConfigureItem extends ItemBase {
  kind: 'configure';
  /** The business requirement, stated as a warehouse scenario. */
  requirement: string;
  choices: Choices;
}

/** Explain a concept in your own words; graded against the cited source. */
export interface ExplainItem extends ItemBase {
  kind: 'explain';
  prompt: string;
  /** The points a complete answer must hit. Used as the grading rubric. */
  rubric: string[];
}

/**
 * Plain recall — a T-code, a table name, an object name. Deliberately the
 * smallest item type: it exists because some detail must become automatic, not
 * because recall is the point.
 */
export interface RecallItem extends ItemBase {
  kind: 'recall';
  front: string;
  back: string;
}

export type Item =
  | SequenceItem
  | TraceItem
  | BreakItem
  | ConfigureItem
  | ExplainItem
  | RecallItem;

/* ───────────────────────────── packaging ───────────────────────────── */

export type SourceKind = 'sap-help-pdf' | 'sap-help-page' | 'user-pdf';

export interface SourceDocument {
  id: string;
  kind: SourceKind;
  title: string;
  /** Origin URL for Help Portal sources; filename for user uploads. */
  origin: string;
  /** When this source was ingested — SAP docs change between releases. */
  ingestedAt: string;
  /** SAP product version the source describes, when stated. */
  productVersion?: string;
  /**
   * Set when the text was NOT fetched directly from `origin`.
   *
   * Provenance belongs here rather than on individual citations. A quote either
   * is or is not present in the text we hold — that is `quoteFound`, and it is
   * a mechanical fact. Whether the text we hold is genuinely the document it
   * claims to be is a different question, it applies to every citation from
   * that source at once, and hiding it inside per-citation flags would let a
   * real limitation disappear into a sea of green badges.
   */
  provenanceNote?: string;
}

/**
 * The unit stored on OneDrive: one process, its items, and the sources both
 * were derived from. Self-contained so it can be cached whole for offline study
 * and re-verified against its sources later.
 */
export interface CoursePack {
  id: string;
  /** 2 introduced the sourced-claim / synthesis split. */
  schemaVersion: 2;
  createdAt: string;
  sources: SourceDocument[];
  process: ProcessModel;
  items: Item[];
}

/* ───────────────────────── expert correction ───────────────────────── */

/**
 * The learner marking generated content as wrong.
 *
 * This is the accuracy mechanism that matters most, and the one no automated
 * check can replace: Vini is an SAP consultant, so on whether a `why` is right
 * he outranks every heuristic in this codebase. Flags are stored separately
 * from packs — a pack is generated content, a flag is his judgement about it,
 * and regenerating the former must not discard the latter.
 */
export interface ContentFlag {
  /** Id of the node, edge, failure mode or item being flagged. */
  targetId: string;
  targetKind: 'node' | 'edge' | 'failure-mode' | 'item';
  /** Which pack the target belongs to. */
  packId: string;
  /** What is wrong. Free text; feeds regeneration and is worth keeping. */
  reason: string;
  flaggedAt: string;
}
