import type { Citation, CoursePack, SourcedClaim, Synthesis } from '../lib/types';

/**
 * Development fixture: EWM inbound, goods receipt to putaway.
 *
 * ─────────────────────────── READ THIS FIRST ───────────────────────────
 * This is a fixture for building the UI against. It is not study material.
 *
 * Its limitation is recorded where it belongs — on the SOURCE DOCUMENTS, via
 * `provenanceNote`. The excerpts below were relayed through a web-search
 * summary of the SAP Help pages rather than fetched from help.sap.com (blocked
 * by the development environment's egress proxy), so the text is second-hand.
 * Every quote genuinely is present in the excerpt it cites, which is what
 * `quoteFound: true` asserts and all it asserts.
 *
 * The `why` and `breaksIf` fields are `origin: 'inferred'` — model reasoning
 * about the process, not SAP's words. That is normal and expected: vendor
 * documentation states what a system does and almost never why. The point of
 * the sourced/synthesis split is that this content is now labelled instead of
 * hiding under a citation that supports only the neighbouring `what`.
 *
 * ── A correction worth keeping in view ──
 * An earlier version of this fixture put `storage-bin` on the happy path AFTER
 * `warehouse-order`. The node's own cited quote says bin determination happens
 * when EWM creates the warehouse task — so the fixture taught an ordering its
 * own source contradicted, and a Sequence-it drill generated from it would have
 * drilled that error. Bin determination is a decision made WITHIN warehouse-task
 * creation, so it now hangs off the spine as a branch. The validator gained a
 * check that every consecutive pair on the happy path is joined by a real edge,
 * which is what would have caught it.
 * ───────────────────────────────────────────────────────────────────────
 */

const HELP_WT_PUTAWAY = 'sap-help-wt-putaway';
const HELP_INBOUND = 'sap-help-inbound-process';

const WT_URL =
  'https://help.sap.com/docs/SAP_EXTENDED_WAREHOUSE_MANAGEMENT/3d97bec9bf1649099384bb8167df3cf2/ffc7cb53ad377114e10000000a174cb4.html';
const INBOUND_URL =
  'https://help.sap.com/docs/SAP_S4HANA_ON-PREMISE/9832125c23154a179bfa1784cdc9577a/e15a4205bb284393add14c9d419fef45.html';

function cite(
  sourceId: string,
  sourceTitle: string,
  url: string,
  locator: string,
  quote: string,
): Citation {
  return { sourceId, sourceTitle, url, locator, quote, quoteFound: true };
}

const wtCite = (locator: string, quote: string) =>
  cite(HELP_WT_PUTAWAY, 'Creation of Warehouse Tasks for Putaway', WT_URL, locator, quote);
const inCite = (locator: string, quote: string) =>
  cite(HELP_INBOUND, 'Inbound Process', INBOUND_URL, locator, quote);

const sourced = (text: string, citations: Citation[]): SourcedClaim => ({ text, citations });
const inferred = (text: string, basedOn: Citation[]): Synthesis => ({
  text,
  origin: 'inferred',
  basedOn,
});

const AUTO_WT = wtCite(
  'Creation of Warehouse Tasks for Putaway',
  'Extended Warehouse Management (EWM) automatically creates warehouse tasks for the putaway based on a warehouse request for an inbound delivery, so that you can put away products.',
);
const PPF_ACTION = wtCite(
  'Creation of Warehouse Tasks for Putaway',
  'EWM can create warehouse tasks for an inbound delivery using an action from the Post Processing Framework (PPF).',
);
const MANUAL_WT = wtCite(
  'Creation of Warehouse Tasks for Putaway — manual creation',
  'If you want to create a warehouse task manually, on the SAP Easy Access screen, choose Extended Warehouse Management → Work Scheduling → Create Warehouse Task for Warehouse Request → Putaway for Inbound Delivery.',
);
const WO_CUSTOMIZING = wtCite(
  'Creation of Warehouse Tasks for Putaway — warehouse order settings',
  'If you want EWM to automatically group warehouse tasks into warehouse orders, you must have made the settings in Customizing for warehouse order creation. In the Implementation Guide (IMG) for EWM, choose Cross-Process Settings → Warehouse Order.',
);
const BIN_DETERMINATION = wtCite(
  'Creation of Warehouse Tasks for Putaway — storage bin determination',
  'When EWM creates a warehouse task for a warehouse request, it uses putaway strategies to determine the storage bin.',
);
const GR_THEN_WT = inCite(
  'Inbound Process',
  'Warehouse tasks for putaway are created after the goods receipt is posted.',
);
const INBOUND_SPAN = inCite(
  'Inbound Process',
  'The inbound process for Advanced Shipping and Receiving in Extended Warehouse Management (EWM) starts with purchasing and ends with putaway in the warehouse.',
);

export const SEED_PACK: CoursePack = {
  id: 'seed-ewm-inbound-putaway',
  schemaVersion: 2,
  createdAt: '2026-09-10T00:00:00.000Z',
  sources: [
    {
      id: HELP_WT_PUTAWAY,
      kind: 'sap-help-page',
      title: 'Creation of Warehouse Tasks for Putaway',
      origin: WT_URL,
      ingestedAt: '2026-09-10T00:00:00.000Z',
      provenanceNote:
        'Excerpt relayed through a web-search summary, not fetched from help.sap.com. Quotes are present in the excerpt we hold; the excerpt itself has not been checked against the live page.',
    },
    {
      id: HELP_INBOUND,
      kind: 'sap-help-page',
      title: 'Inbound Process',
      origin: INBOUND_URL,
      ingestedAt: '2026-09-10T00:00:00.000Z',
      provenanceNote:
        'Excerpt relayed through a web-search summary, not fetched from help.sap.com. Quotes are present in the excerpt we hold; the excerpt itself has not been checked against the live page.',
    },
  ],
  process: {
    id: 'ewm-inbound-putaway',
    title: 'Inbound: goods receipt to putaway',
    module: 'SAP EWM',
    summary:
      'The inbound process starts with purchasing and ends with stock in a bin. ' +
      'The thing worth understanding is not the sequence but the hand-offs: what ' +
      'each document authorises, what triggers the next object to exist, and which ' +
      'decision determines where the stock physically lands.',
    nodes: [
      {
        id: 'inbound-delivery',
        label: 'Inbound delivery',
        kind: 'document',
        what: sourced(
          'The warehouse request that tells EWM goods are expected, and on which putaway warehouse tasks are based.',
          [AUTO_WT],
        ),
        why: inferred(
          'It is the authorisation boundary. EWM acts on a warehouse request, not on a purchase order — which is what turns expected goods from a plan into work the warehouse can see.',
          [AUTO_WT],
        ),
        breaksIf: inferred(
          'With no inbound delivery there is no warehouse request, so there is nothing for EWM to create putaway tasks from and the goods have no route into the warehouse.',
          [AUTO_WT],
        ),
        tcodes: [],
      },
      {
        id: 'goods-receipt',
        label: 'Post goods receipt',
        kind: 'step',
        what: sourced(
          'Recording that the goods have physically arrived. Putaway warehouse tasks are created after this posting.',
          [GR_THEN_WT],
        ),
        why: inferred(
          'It is the point where expected stock becomes real stock. Ordering putaway before it would mean moving inventory the system does not yet believe exists.',
          [GR_THEN_WT],
        ),
        breaksIf: inferred(
          'If the goods receipt has not posted, the absence of putaway work is correct behaviour rather than a fault — which is why "no warehouse task" should send you to check the GR before you check configuration.',
          [GR_THEN_WT],
        ),
        tcodes: [],
      },
      {
        id: 'warehouse-task',
        label: 'Warehouse task',
        kind: 'object',
        what: sourced(
          'The instruction to move a quantity to a destination. EWM can create it automatically through a Post Processing Framework action, or you can create it manually from Work Scheduling.',
          [PPF_ACTION, MANUAL_WT],
        ),
        why: inferred(
          'It is the unit of physical work. Everything upstream describes what should happen; the warehouse task is the first object that tells someone to actually move something.',
          [PPF_ACTION],
        ),
        breaksIf: inferred(
          'If the PPF action is not configured or does not fire, no putaway work reaches the floor even though the goods receipt posted cleanly. That is why "GR posted but nothing to do" points at PPF rather than at the delivery.',
          [PPF_ACTION],
        ),
        tcodes: [],
      },
      {
        id: 'storage-bin',
        label: 'Storage bin determination',
        kind: 'decision',
        what: sourced(
          'The determination of which bin the stock goes to, made by putaway strategies at the moment EWM creates the warehouse task.',
          [BIN_DETERMINATION],
        ),
        why: inferred(
          'This is where warehouse policy becomes a physical location. The strategy encodes business intent — fast movers near despatch, hazardous goods segregated — as an automatic per-item choice.',
          [BIN_DETERMINATION],
        ),
        breaksIf: inferred(
          'A wrong or missing putaway strategy does not fail loudly. Stock lands in the wrong bin type and the cost surfaces later as slow picking or a compliance problem, not as an error at putaway time.',
          [BIN_DETERMINATION],
        ),
        tcodes: [],
      },
      {
        id: 'warehouse-order',
        label: 'Warehouse order',
        kind: 'object',
        what: sourced(
          'A grouping of warehouse tasks issued as one piece of work. Automatic grouping requires warehouse order creation settings in Customizing.',
          [WO_CUSTOMIZING],
        ),
        why: inferred(
          'It exists for the human, not the system. Tasks are the right unit for inventory accuracy but a poor unit for a person walking a warehouse; the order groups them into a sensible trip.',
          [WO_CUSTOMIZING],
        ),
        breaksIf: inferred(
          'Without the Customizing settings, tasks are not grouped as intended and the floor receives work in an inefficient shape even though every individual task is correct.',
          [WO_CUSTOMIZING],
        ),
        tcodes: [],
        configPath: {
          value: 'Cross-Process Settings → Warehouse Order',
          foundInSource: true,
          citation: WO_CUSTOMIZING,
        },
      },
    ],
    edges: [
      {
        id: 'e-delivery-gr',
        from: 'inbound-delivery',
        to: 'goods-receipt',
        label: sourced('Goods physically arrive against the expected delivery.', [INBOUND_SPAN]),
      },
      {
        id: 'e-gr-wt',
        from: 'goods-receipt',
        to: 'warehouse-task',
        label: sourced(
          'Posting the goods receipt is what putaway task creation follows.',
          [GR_THEN_WT, PPF_ACTION],
        ),
      },
      {
        id: 'e-wt-bin',
        from: 'warehouse-task',
        to: 'storage-bin',
        label: sourced(
          'Creating the task is when putaway strategies determine the destination bin.',
          [BIN_DETERMINATION],
        ),
      },
      {
        id: 'e-wt-wo',
        from: 'warehouse-task',
        to: 'warehouse-order',
        label: sourced('Tasks are grouped into an order per Customizing.', [WO_CUSTOMIZING]),
      },
    ],
    failureModes: [
      {
        id: 'fm-no-wt-after-gr',
        symptom: sourced(
          'Goods receipt posted, but no putaway warehouse task appears.',
          [GR_THEN_WT],
        ),
        cause: inferred(
          'The Post Processing Framework action that creates warehouse tasks for the inbound delivery did not run.',
          [PPF_ACTION],
        ),
        nodeIds: ['goods-receipt', 'warehouse-task'],
        resolution: sourced(
          'Create the task manually from Work Scheduling → Create Warehouse Task for Warehouse Request → Putaway for Inbound Delivery to unblock the stock, then correct the PPF action.',
          [MANUAL_WT],
        ),
      },
      {
        id: 'fm-tasks-not-grouped',
        symptom: sourced(
          'Warehouse tasks are created correctly but are not grouped into warehouse orders.',
          [WO_CUSTOMIZING],
        ),
        cause: inferred(
          'Warehouse order creation settings have not been maintained in Customizing.',
          [WO_CUSTOMIZING],
        ),
        nodeIds: ['warehouse-order'],
        resolution: sourced(
          'Maintain warehouse order creation in the IMG for EWM under Cross-Process Settings → Warehouse Order.',
          [WO_CUSTOMIZING],
        ),
      },
    ],
    /**
     * Only genuinely sequential steps. `storage-bin` is deliberately absent: it
     * is determined DURING warehouse-task creation, so it is a branch off the
     * spine (edge `e-wt-bin`), not a step after `warehouse-order`.
     */
    happyPath: ['inbound-delivery', 'goods-receipt', 'warehouse-task', 'warehouse-order'],
  },
  items: [
    {
      id: 'seq-inbound-happy-path',
      kind: 'sequence',
      nodeIds: ['inbound-delivery', 'goods-receipt', 'warehouse-task', 'warehouse-order'],
      prompt: 'Put the inbound putaway process in order, from expected goods to grouped work.',
      correctOrder: [
        'inbound-delivery',
        'goods-receipt',
        'warehouse-task',
        'warehouse-order',
      ],
      consequences: {
        'inbound-delivery':
          'Without the warehouse request first, EWM has no basis on which to create putaway work at all.',
        'goods-receipt':
          'Order putaway before the GR and you are moving stock the system does not yet believe exists.',
        'warehouse-task':
          'Nothing physical happens until a task exists — everything before it is intent, not work.',
        'warehouse-order':
          'Group before the tasks exist and there is nothing to group.',
      },
      basedOn: [GR_THEN_WT, WO_CUSTOMIZING],
    },
  ],
};
