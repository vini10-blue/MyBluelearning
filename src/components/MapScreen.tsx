import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { getPack } from '../lib/packs';
import { flagsForPack, rejectFlagged } from '../lib/contentFlags';
import { FlagButton } from './FlagButton';
import type {
  NodeKind,
  ProcessEdge,
  ProcessNode,
  SourcedClaim,
  SourcedToken,
  Synthesis,
} from '../lib/types';
import { CitationList } from './CitationList';

/**
 * Map mode — 4C/ID's supportive information.
 *
 * Rendered as a vertical flow rather than a free-form node graph. A
 * force-directed diagram looks better on a laptop and is unusable on a phone; a
 * vertical spine with labelled connectors is still a real process diagram,
 * stays readable at 400px, and matches how the Walkthrough narrates it.
 *
 * The screen's job beyond layout is to keep two kinds of content visually
 * distinct: what the documentation states, and what Claude reasoned from it.
 * If those look alike here, the whole sourced/synthesis split in the model is
 * decoration.
 */
export function MapScreen() {
  const { packId, nodeId } = useParams();
  const navigate = useNavigate();
  const pack = getPack(packId);
  // Bumped whenever a flag changes, to re-read the (localStorage-backed) list.
  const [flagTick, setFlagTick] = useState(0);

  if (!pack) {
    return (
      <main className="min-h-full px-5 py-10 text-center">
        <p className="text-sm text-slate-600">That course pack does not exist.</p>
        <Link to="/" className="mt-4 inline-block text-sm font-medium text-blue-700 underline">
          Back to packs
        </Link>
      </main>
    );
  }

  const { process } = pack;

  /**
   * Content the learner has marked wrong is removed, not annotated. Leaving a
   * known-wrong step on the map with a warning would put the burden back on him
   * to remember, every time, which parts are untrue.
   */
  void flagTick;
  const flaggedIds = new Set(flagsForPack(pack.id).map((f) => f.targetId));
  const liveNodes = rejectFlagged(pack.id, process.nodes);
  const liveEdges = process.edges.filter(
    (e) => !flaggedIds.has(e.from) && !flaggedIds.has(e.to) && !flaggedIds.has(e.id),
  );
  const byId = new Map(liveNodes.map((n) => [n.id, n]));
  const pathNodes = process.happyPath
    .map((id) => byId.get(id))
    .filter((n): n is ProcessNode => Boolean(n));

  // Nodes not on the spine — decisions and branches hang off it rather than
  // interrupting it. Bin determination is the canonical case: it happens WITHIN
  // warehouse-task creation, so listing it as a sequential step would teach a
  // false ordering.
  const offPath = liveNodes.filter((n) => !process.happyPath.includes(n.id));

  const selected = nodeId ? byId.get(nodeId) ?? null : null;

  function edgeAfter(id: string): ProcessEdge | undefined {
    return liveEdges.find((e) => e.from === id && process.happyPath.includes(e.to));
  }

  return (
    <main className="min-h-full px-5 pt-6 pb-[calc(env(safe-area-inset-bottom)+24px)]">
      <div className="mx-auto w-full max-w-md">
        <Link to="/" className="text-sm font-medium text-slate-500 hover:text-slate-700">
          ← Packs
        </Link>

        <header className="mt-4">
          <p className="text-xs font-medium uppercase tracking-wide text-slate-400">
            {process.module} · Map
          </p>
          <h1 className="mt-1 text-xl font-semibold tracking-tight text-slate-900">
            {process.title}
          </h1>
          <p className="mt-2 text-sm text-slate-600">{process.summary}</p>
        </header>

        <ol className="mt-8">
          {pathNodes.map((node, i) => {
            const edge = edgeAfter(node.id);
            const isLast = i === pathNodes.length - 1;
            return (
              <li key={node.id}>
                <button
                  type="button"
                  onClick={() => navigate(`/pack/${pack.id}/map/${node.id}`)}
                  className="w-full rounded-2xl bg-white p-4 text-left shadow-sm ring-1 ring-slate-200 active:scale-[0.99] transition"
                >
                  <div className="flex items-center gap-3">
                    <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-slate-900 text-xs font-semibold text-white">
                      {i + 1}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-semibold text-slate-900">
                        {node.label}
                      </span>
                      <KindBadge kind={node.kind} />
                    </span>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="shrink-0 text-slate-300" aria-hidden="true">
                      <path d="m9 18 6-6-6-6" />
                    </svg>
                  </div>
                  <p className="mt-2 text-sm text-slate-600">{node.what.text}</p>
                </button>

                {/* A connector is drawn only when an edge actually asserts the
                    ordering. The validator makes a missing edge fatal, so this
                    should never render empty — but inventing a "then" label for
                    an ordering nothing claims is how a false sequence got into
                    this app once already. */}
                {!isLast && edge && (
                  <div className="flex items-stretch gap-3 py-1 pl-3.5">
                    <div className="w-px bg-slate-300" aria-hidden="true" />
                    <p className="py-2 text-xs italic text-slate-500">{edge.label.text}</p>
                  </div>
                )}
              </li>
            );
          })}
        </ol>

        {offPath.length > 0 && (
          <section className="mt-8">
            <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-400">
              Decisions made within these steps
            </h2>
            <p className="mt-1 text-xs text-slate-500">
              Not later steps — these happen inside the steps above.
            </p>
            <div className="mt-3 space-y-2">
              {offPath.map((node) => (
                <button
                  key={node.id}
                  type="button"
                  onClick={() => navigate(`/pack/${pack.id}/map/${node.id}`)}
                  className="w-full rounded-xl bg-slate-50 p-3 text-left ring-1 ring-slate-200 active:scale-[0.99] transition"
                >
                  <span className="block text-sm font-medium text-slate-800">{node.label}</span>
                  <KindBadge kind={node.kind} />
                  {liveEdges
                    .filter((e) => e.to === node.id)
                    .slice(0, 1)
                    .map((e) => (
                      <span key={e.id} className="mt-1 block text-xs italic text-slate-500">
                        during {byId.get(e.from)?.label ?? e.from}
                      </span>
                    ))}
                </button>
              ))}
            </div>
          </section>
        )}

        {process.failureModes.length > 0 && (
          <section className="mt-8">
            <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-400">
              When it goes wrong
            </h2>
            <div className="mt-3 space-y-3">
              {process.failureModes.map((fm) => (
                <div key={fm.id} className="rounded-xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
                  <p className="text-sm font-medium text-slate-900">{fm.symptom.text}</p>
                  <CitationList citations={fm.symptom.citations} />
                  <div className="mt-3">
                    <SynthesisBlock label="Likely cause" synthesis={fm.cause} />
                  </div>
                  <p className="mt-3 text-sm text-slate-600">
                    <span className="font-medium text-slate-700">Fix: </span>
                    {fm.resolution.text}
                  </p>
                  <CitationList citations={fm.resolution.citations} />
                </div>
              ))}
            </div>
          </section>
        )}
      </div>

      {flaggedIds.size > 0 && (
        <p className="mx-auto mt-6 w-full max-w-md text-center text-xs text-slate-400">
          {flaggedIds.size} item{flaggedIds.size === 1 ? '' : 's'} hidden because you marked
          {flaggedIds.size === 1 ? ' it' : ' them'} wrong.
        </p>
      )}

      {selected && (
        <NodeDetail
          node={selected}
          packId={pack.id}
          onFlagChange={() => setFlagTick((t) => t + 1)}
          onClose={() => navigate(`/pack/${pack.id}/map`)}
        />
      )}
    </main>
  );
}

const KIND_LABEL: Record<NodeKind, string> = {
  step: 'action',
  document: 'document',
  object: 'object',
  decision: 'decision',
  system: 'system',
};

function KindBadge({ kind }: { kind: NodeKind }) {
  return (
    <span className="mt-0.5 inline-block rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-slate-500">
      {KIND_LABEL[kind]}
    </span>
  );
}

/** A claim the documentation states, with its evidence. */
function SourcedBlock({ label, claim }: { label: string; claim: SourcedClaim }) {
  return (
    <div>
      <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-400">{label}</h3>
      <p className="mt-1 rounded-lg bg-slate-50 p-3 text-sm text-slate-700 ring-1 ring-slate-200">
        {claim.text}
      </p>
      <CitationList citations={claim.citations} role="source" />
    </div>
  );
}

/**
 * Claude's reasoning, marked as such.
 *
 * The dashed border and the explicit attribution line are load-bearing, not
 * decoration. Documentation states what a system does and rarely why, so this
 * content is nearly always inference — and an inference that looks sourced is
 * more dangerous than one that looks unsourced, because it stops the reader
 * checking. The supporting passages are offered as something to judge the
 * reasoning against, never as proof of it.
 */
function SynthesisBlock({ label, synthesis }: { label: string; synthesis: Synthesis }) {
  return (
    <div>
      <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-400">{label}</h3>
      <div className="mt-1 rounded-lg border border-dashed border-violet-300 bg-violet-50/60 p-3">
        <p className="text-sm text-violet-950">{synthesis.text}</p>
        <p className="mt-2 flex items-center gap-1.5 text-[11px] font-medium text-violet-700">
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true">
            <path d="M12 2v4M12 18v4M4.9 4.9l2.9 2.9M16.2 16.2l2.9 2.9M2 12h4M18 12h4M4.9 19.1l2.9-2.9M16.2 7.8l2.9-2.9" />
          </svg>
          {synthesis.origin === 'stated'
            ? "Stated by the documentation"
            : "Claude's reading — not stated in the source"}
        </p>
      </div>
      <CitationList citations={synthesis.basedOn} role="support" />
    </div>
  );
}

/** A literal token, shown only because it was located in the source. */
function TokenChip({ token }: { token: SourcedToken }) {
  return (
    <span className="rounded bg-slate-100 px-2 py-1 font-mono text-xs text-slate-700">
      {token.value}
    </span>
  );
}

/**
 * Step detail. Section order is deliberate: what it is, then why it exists,
 * then what breaks without it. The last two are the reason this app exists — a
 * learner who can recite the sequence but cannot answer them has memorised
 * rather than understood.
 */
function NodeDetail({
  node,
  packId,
  onFlagChange,
  onClose,
}: {
  node: ProcessNode;
  packId: string;
  onFlagChange: () => void;
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center bg-slate-900/40 p-0 sm:items-center sm:p-6">
      <div className="max-h-[85vh] w-full max-w-md overflow-y-auto rounded-t-2xl bg-white p-5 pb-[calc(env(safe-area-inset-bottom)+20px)] shadow-xl sm:rounded-2xl">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-slate-900">{node.label}</h2>
            <KindBadge kind={node.kind} />
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="shrink-0 rounded-lg p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="mt-4 space-y-4">
          <SourcedBlock label="What it is" claim={node.what} />
          <SynthesisBlock label="Why it exists" synthesis={node.why} />
          <SynthesisBlock label="What breaks without it" synthesis={node.breaksIf} />
        </div>

        {node.configPath && (
          <div className="mt-4">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-400">
              Where to configure it
            </h3>
            <p className="mt-1 rounded-lg bg-slate-50 p-3 font-mono text-xs text-slate-700 ring-1 ring-slate-200">
              {node.configPath.value}
            </p>
            {node.configPath.citation && (
              <CitationList citations={[node.configPath.citation]} role="source" />
            )}
          </div>
        )}

        <FlagButton
          packId={packId}
          targetId={node.id}
          targetKind="node"
          onChange={() => {
            onFlagChange();
            onClose();
          }}
        />

        {node.tcodes.length > 0 && (
          <div className="mt-4">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-400">
              Transaction codes
            </h3>
            <div className="mt-1 flex flex-wrap gap-1.5">
              {node.tcodes.map((t) => (
                <TokenChip key={t.value} token={t} />
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
