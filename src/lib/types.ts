/**
 * The domain model for MyBlueLearning.
 *
 * Everything in the app is generated from a ProcessModel: the Map renders its
 * graph, the Walkthrough narrates a path through it, every drill is generated
 * against its nodes and edges, and Explain grades free text against the source
 * text those nodes cite.
 *
 * The design constraint that shapes all of this: the goal is understanding
 * processes, not memorising facts. That is why a node carries `why` and
 * `breaksIf` as required fields alongside `what` — a node that cannot say why
 * it exists and what fails without it is not worth drilling, and the ingest
 * prompt is instructed to produce all three or omit the node.
 */

/**
 * A pointer back to the source text that justifies a claim.
 *
 * Every generated node, edge and item carries at least one. This is the
 * accuracy guard: SAP specifics (T-codes, config paths, table and object
 * names) are exactly where a model produces plausible-but-wrong content, and a
 * wrong item under spaced repetition actively teaches the error. An item that
 * cannot cite its source is rejected at ingest rather than shown.
 */
export interface Citation {
  /** Id of the SourceDocument this came from. */
  sourceId: string;
  /** Human-readable source name, shown in the UI. */
  sourceTitle: string;
  /**
   * Where in the source. Page number for PDFs ("p. 412"), section heading or
   * anchor for HTML pages.
   */
  locator: string;
  /**
   * Deep link to the exact page, when the source has one. SAP Help Portal
   * pages and PDF page anchors both do; a user-supplied book PDF may not.
   */
  url?: string;
  /**
   * The verbatim supporting sentence(s) from the source. Shown on tap so a
   * claim can be checked without leaving the app, and used as the reference
   * text when Explain grades an answer.
   */
  quote: string;
  /**
   * Whether this quote has been checked against the live source, as opposed
   * to merely being attributed to it.
   *
   * The distinction is not pedantic. A model can produce a citation whose URL
   * is real and whose quote is invented, and that is a more dangerous artifact
   * than an obviously uncited claim, because it looks checked. Unverified
   * citations render with a warning in the UI, and content resting only on
   * them is never promoted into the spaced-repetition schedule.
   */
  verified: boolean;
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
  /** What this is — the definition. */
  what: string;
  /**
   * Why this step exists in the process. The understanding payload: this is
   * what separates knowing the sequence from knowing the process.
   */
  why: string;
  /**
   * What breaks downstream if this is skipped, misconfigured or wrong. Drives
   * the feedback text in Sequence-it and the scenarios in Break-it.
   */
  breaksIf: string;
  /** Transaction codes associated with this node, if any. */
  tcodes?: string[];
  /** Customizing / IMG path, when this node is configuration-relevant. */
  configPath?: string;
  /**
   * Curated SAP screen recording showing this step in the real UI. Not
   * generated — a real published SAP video, mapped onto the node. Covers what
   * a diagram genuinely handles worse than a recording: recognising the actual
   * RF or Fiori screen.
   */
  videoUrl?: string;
  citations: Citation[];
}

export interface ProcessEdge {
  id: string;
  /** Source node id. */
  from: string;
  /** Target node id. */
  to: string;
  /** What flows or what triggers ("PPF action creates warehouse task"). */
  label: string;
  /** For edges leaving a decision node: the branch condition. */
  condition?: string;
  citations: Citation[];
}

/**
 * A known way the process goes wrong. Harvested at ingest because these are
 * the raw material for Break-it drills, and because the exam's scenario format
 * tests exactly this kind of judgement.
 */
export interface FailureMode {
  id: string;
  /** What the learner observes ("Warehouse task is not created after GR"). */
  symptom: string;
  /** The underlying cause. */
  cause: string;
  /** Node ids this failure touches. */
  nodeIds: string[];
  /** How it is diagnosed or resolved. */
  resolution: string;
  citations: Citation[];
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
   * The node ids forming the canonical happy path, in order. The Walkthrough
   * narrates this, and Sequence-it drills it.
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
  citations: Citation[];
}

/** Put the process steps in the right order. */
export interface SequenceItem extends ItemBase {
  kind: 'sequence';
  prompt: string;
  /** Node ids in correct order. */
  correctOrder: string[];
  /**
   * Per-node consequence text, keyed by node id: what breaks downstream when
   * this step lands out of place. Feedback reveals the consequence rather than
   * marking the answer red.
   */
  consequences: Record<string, string>;
}

/** Given a document or object, what is created next and posted where. */
export interface TraceItem extends ItemBase {
  kind: 'trace';
  /** The starting document/object and its state. */
  given: string;
  question: string;
  options: string[];
  correctIndex: number;
  /** Why each option is right or wrong — shown after answering, for all options. */
  rationales: string[];
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
  options: string[];
  correctIndex: number;
  /** What the learner observes after choosing each option. */
  outcomes: string[];
}

/** Business requirement in, configuration path out. Mirrors the exam format. */
export interface ConfigureItem extends ItemBase {
  kind: 'configure';
  /** The business requirement, stated as a warehouse scenario. */
  requirement: string;
  options: string[];
  correctIndex: number;
  rationales: string[];
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
 * smallest item type: it exists because some detail genuinely must become
 * automatic, not because recall is the point.
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
}

/**
 * The unit stored on OneDrive: one process, its items, and the sources both
 * were derived from. Self-contained so it can be cached whole for offline
 * study and re-verified against its sources later.
 */
export interface CoursePack {
  id: string;
  schemaVersion: 1;
  createdAt: string;
  sources: SourceDocument[];
  process: ProcessModel;
  items: Item[];
}
