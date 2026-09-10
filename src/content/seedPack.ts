import type { Citation, CoursePack } from '../lib/types';

/**
 * Development fixture: EWM inbound, goods receipt to putaway.
 *
 * ─────────────────────────── READ THIS FIRST ───────────────────────────
 * This is NOT verified study content and must not be treated as such.
 *
 * Every citation below carries `verified: false`, for two separate reasons:
 *
 *  1. The quotes were relayed through a web-search summary of the SAP Help
 *     pages, not read from the pages themselves — help.sap.com is blocked by
 *     the development environment's egress proxy, so the quotes could not be
 *     checked against the live source.
 *  2. The `why` and `breaksIf` text on each node is model-authored inference
 *     about the process, not quoted from SAP. It is exactly the class of
 *     content the accuracy guard exists to distrust.
 *
 * The fixture exists so the Map, Walkthrough and drill UIs can be built and
 * demonstrated against a realistically shaped pack before the ingest pipeline
 * is reachable. First real task once the app is deployed: re-ingest this
 * process from the live SAP Help Portal and let the generated pack replace
 * this file entirely.
 * ───────────────────────────────────────────────────────────────────────
 */

const HELP_WT_PUTAWAY = 'sap-help-wt-putaway';
const HELP_INBOUND = 'sap-help-inbound-process';

const WT_URL =
  'https://help.sap.com/docs/SAP_EXTENDED_WAREHOUSE_MANAGEMENT/3d97bec9bf1649099384bb8167df3cf2/ffc7cb53ad377114e10000000a174cb4.html';
const INBOUND_URL =
  'https://help.sap.com/docs/SAP_S4HANA_ON-PREMISE/9832125c23154a179bfa1784cdc9577a/e15a4205bb284393add14c9d419fef45.html';

/** Helper so every citation in this file is unmistakably marked unverified. */
function cite(
  sourceId: string,
  sourceTitle: string,
  url: string,
  locator: string,
  quote: string,
): Citation {
  return { sourceId, sourceTitle, url, locator, quote, verified: false };
}

const wtCite = (locator: string, quote: string) =>
  cite(HELP_WT_PUTAWAY, 'Creation of Warehouse Tasks for Putaway', WT_URL, locator, quote);
const inCite = (locator: string, quote: string) =>
  cite(HELP_INBOUND, 'Inbound Process', INBOUND_URL, locator, quote);

export const SEED_PACK: CoursePack = {
  id: 'seed-ewm-inbound-putaway',
  schemaVersion: 1,
  createdAt: '2026-09-10T00:00:00.000Z',
  sources: [
    {
      id: HELP_WT_PUTAWAY,
      kind: 'sap-help-page',
      title: 'Creation of Warehouse Tasks for Putaway',
      origin: WT_URL,
      ingestedAt: '2026-09-10T00:00:00.000Z',
    },
    {
      id: HELP_INBOUND,
      kind: 'sap-help-page',
      title: 'Inbound Process',
      origin: INBOUND_URL,
      ingestedAt: '2026-09-10T00:00:00.000Z',
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
        what:
          'The warehouse request telling EWM that goods are expected, and what they are.',
        why:
          'It is the authorisation boundary. EWM will not create putaway work from a ' +
          'purchase order alone — it acts on a warehouse request, which is what makes ' +
          'the expected goods visible to the warehouse as work rather than as a plan.',
        breaksIf:
          'With no inbound delivery there is no warehouse request, so no warehouse ' +
          'task can be created and the goods have no route into the warehouse.',
        citations: [
          wtCite(
            'Creation of Warehouse Tasks for Putaway',
            'Extended Warehouse Management (EWM) automatically creates warehouse tasks for the putaway based on a warehouse request for an inbound delivery, so that you can put away products.',
          ),
        ],
      },
      {
        id: 'goods-receipt',
        label: 'Post goods receipt',
        kind: 'step',
        what: 'Recording that the goods have physically arrived.',
        why:
          'It is the point where expected stock becomes real stock. Ordering the ' +
          'putaway before this would mean moving inventory the system does not yet ' +
          'believe exists.',
        breaksIf:
          'Putaway warehouse tasks are created after the goods receipt is posted, so ' +
          'if the GR has not posted, the absence of putaway work is the expected ' +
          'behaviour rather than a fault to troubleshoot.',
        citations: [
          inCite(
            'Inbound Process',
            'The inbound process for Advanced Shipping and Receiving in Extended Warehouse Management (EWM) starts with purchasing and ends with putaway in the warehouse. Warehouse tasks for putaway are created after the goods receipt is posted.',
          ),
        ],
      },
      {
        id: 'warehouse-task',
        label: 'Warehouse task',
        kind: 'object',
        what: 'The instruction to move a specific quantity to a specific destination.',
        why:
          'It is the unit of physical work. Everything upstream is paperwork about ' +
          'what should happen; the warehouse task is the first object that tells a ' +
          'person or a robot to actually move something.',
        breaksIf:
          'If the Post Processing Framework action that creates it is not configured ' +
          'or does not fire, no putaway work reaches the floor even though the goods ' +
          'receipt posted cleanly — which is why "GR posted but nothing to do" points ' +
          'at PPF rather than at the delivery.',
        configPath:
          'SAP Easy Access: Extended Warehouse Management → Work Scheduling → Create Warehouse Task for Warehouse Request → Putaway for Inbound Delivery',
        citations: [
          wtCite(
            'Creation of Warehouse Tasks for Putaway',
            'EWM can create warehouse tasks for an inbound delivery using an action from the Post Processing Framework (PPF).',
          ),
          wtCite(
            'Creation of Warehouse Tasks for Putaway — manual creation',
            'If you want to create a warehouse task manually, on the SAP Easy Access screen, choose Extended Warehouse Management → Work Scheduling → Create Warehouse Task for Warehouse Request → Putaway for Inbound Delivery.',
          ),
        ],
      },
      {
        id: 'warehouse-order',
        label: 'Warehouse order',
        kind: 'object',
        what: 'A bundle of warehouse tasks issued to one resource as one piece of work.',
        why:
          'It exists for the human, not the system. Tasks are the correct unit for ' +
          'inventory accuracy but a terrible unit for a picker walking a warehouse; ' +
          'the order groups them into a sensible trip.',
        breaksIf:
          'Grouping depends on warehouse order creation settings in Customizing. ' +
          'Without them, tasks are not grouped as intended and the floor receives ' +
          'work in an inefficient shape even though every task is individually correct.',
        configPath: 'IMG for EWM: Cross-Process Settings → Warehouse Order',
        citations: [
          wtCite(
            'Creation of Warehouse Tasks for Putaway — warehouse order settings',
            'If you want EWM to automatically group warehouse tasks into warehouse orders, you must have made the settings in Customizing for warehouse order creation. In the Implementation Guide (IMG) for EWM, choose Cross-Process Settings → Warehouse Order.',
          ),
        ],
      },
      {
        id: 'storage-bin',
        label: 'Storage bin determination',
        kind: 'decision',
        what:
          'The decision of which bin the stock goes into, made by the putaway strategy.',
        why:
          'This is where warehouse policy becomes a physical location. The strategy ' +
          'is the lever that encodes business intent — fast movers near despatch, ' +
          'hazardous goods segregated — into an automatic per-item choice.',
        breaksIf:
          'A wrong or missing putaway strategy does not fail loudly. Stock lands in ' +
          'the wrong bin type and the cost shows up later as slow picking or a ' +
          'compliance problem, not as an error message at putaway time.',
        citations: [
          wtCite(
            'Creation of Warehouse Tasks for Putaway — storage bin determination',
            'When EWM creates a warehouse task for a warehouse request, it uses putaway strategies to determine the storage bin.',
          ),
        ],
      },
    ],
    edges: [
      {
        id: 'e-delivery-gr',
        from: 'inbound-delivery',
        to: 'goods-receipt',
        label: 'goods physically arrive against the delivery',
        citations: [
          inCite(
            'Inbound Process',
            'The inbound process for Advanced Shipping and Receiving in Extended Warehouse Management (EWM) starts with purchasing and ends with putaway in the warehouse.',
          ),
        ],
      },
      {
        id: 'e-gr-wt',
        from: 'goods-receipt',
        to: 'warehouse-task',
        label: 'GR posting triggers putaway task creation (PPF action)',
        citations: [
          inCite(
            'Inbound Process',
            'Warehouse tasks for putaway are created after the goods receipt is posted.',
          ),
          wtCite(
            'Creation of Warehouse Tasks for Putaway',
            'EWM can create warehouse tasks for an inbound delivery using an action from the Post Processing Framework (PPF).',
          ),
        ],
      },
      {
        id: 'e-wt-wo',
        from: 'warehouse-task',
        to: 'warehouse-order',
        label: 'tasks grouped into an order per Customizing',
        citations: [
          wtCite(
            'Creation of Warehouse Tasks for Putaway — warehouse order settings',
            'If you want EWM to automatically group warehouse tasks into warehouse orders, you must have made the settings in Customizing for warehouse order creation.',
          ),
        ],
      },
      {
        id: 'e-wt-bin',
        from: 'warehouse-task',
        to: 'storage-bin',
        label: 'putaway strategy determines the destination bin',
        citations: [
          wtCite(
            'Creation of Warehouse Tasks for Putaway — storage bin determination',
            'When EWM creates a warehouse task for a warehouse request, it uses putaway strategies to determine the storage bin.',
          ),
        ],
      },
    ],
    failureModes: [
      {
        id: 'fm-no-wt-after-gr',
        symptom: 'Goods receipt posted, but no putaway warehouse task appears.',
        cause:
          'The Post Processing Framework action that creates warehouse tasks for the ' +
          'inbound delivery did not run.',
        nodeIds: ['goods-receipt', 'warehouse-task'],
        resolution:
          'Check the PPF action for the inbound delivery. A warehouse task can also ' +
          'be created manually via Work Scheduling → Create Warehouse Task for ' +
          'Warehouse Request → Putaway for Inbound Delivery to unblock the stock ' +
          'while the configuration is corrected.',
        citations: [
          wtCite(
            'Creation of Warehouse Tasks for Putaway',
            'EWM can create warehouse tasks for an inbound delivery using an action from the Post Processing Framework (PPF).',
          ),
        ],
      },
      {
        id: 'fm-tasks-not-grouped',
        symptom:
          'Warehouse tasks are created correctly but arrive as separate items rather than grouped work.',
        cause: 'Warehouse order creation settings are missing in Customizing.',
        nodeIds: ['warehouse-order'],
        resolution:
          'Maintain warehouse order creation in the IMG for EWM under Cross-Process Settings → Warehouse Order.',
        citations: [
          wtCite(
            'Creation of Warehouse Tasks for Putaway — warehouse order settings',
            'If you want EWM to automatically group warehouse tasks into warehouse orders, you must have made the settings in Customizing for warehouse order creation. In the Implementation Guide (IMG) for EWM, choose Cross-Process Settings → Warehouse Order.',
          ),
        ],
      },
    ],
    happyPath: [
      'inbound-delivery',
      'goods-receipt',
      'warehouse-task',
      'warehouse-order',
      'storage-bin',
    ],
  },
  items: [
    {
      id: 'seq-inbound-happy-path',
      kind: 'sequence',
      nodeIds: [
        'inbound-delivery',
        'goods-receipt',
        'warehouse-task',
        'warehouse-order',
        'storage-bin',
      ],
      prompt: 'Put the inbound putaway process in order, from expected goods to stock in a bin.',
      correctOrder: [
        'inbound-delivery',
        'goods-receipt',
        'warehouse-task',
        'warehouse-order',
        'storage-bin',
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
        'storage-bin':
          'Determine the bin before the task exists and there is no work to attach the destination to.',
      },
      citations: [
        inCite(
          'Inbound Process',
          'Warehouse tasks for putaway are created after the goods receipt is posted.',
        ),
      ],
    },
  ],
};
