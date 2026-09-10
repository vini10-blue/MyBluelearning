import { Link, useNavigate, useParams } from 'react-router-dom';
import { getPack } from '../lib/packs';
import type { NodeKind, ProcessEdge, ProcessNode } from '../lib/types';
import { CitationList } from './CitationList';

/**
 * Map mode — 4C/ID's supportive information.
 *
 * Rendered as a vertical flow rather than a free-form node graph. A
 * force-directed diagram looks more impressive on a laptop and is unusable on
 * a phone; a vertical spine with labelled connectors is still a real process
 * diagram, stays readable at 400px, and matches how the process is actually
 * narrated in the Walkthrough.
 *
 * Tapping a step opens its detail at its own URL, so a citation elsewhere in
 * the app can deep-link straight to the step it concerns.
 */
export function MapScreen() {
  const { packId, nodeId } = useParams();
  const navigate = useNavigate();
  const pack = getPack(packId);

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
  const byId = new Map(process.nodes.map((n) => [n.id, n]));
  const pathNodes = process.happyPath
    .map((id) => byId.get(id))
    .filter((n): n is ProcessNode => Boolean(n));

  // Nodes reachable from the process but not on the happy path — branches and
  // decisions hang off the spine rather than interrupting it.
  const offPath = process.nodes.filter((n) => !process.happyPath.includes(n.id));

  const selected = nodeId ? byId.get(nodeId) ?? null : null;

  function edgeAfter(id: string): ProcessEdge | undefined {
    return process.edges.find((e) => e.from === id && process.happyPath.includes(e.to));
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
                  <p className="mt-2 text-sm text-slate-600">{node.what}</p>
                </button>

                {!isLast && (
                  <div className="flex items-stretch gap-3 py-1 pl-3.5">
                    <div className="w-px bg-slate-300" aria-hidden="true" />
                    <p className="py-2 text-xs italic text-slate-500">
                      {edge?.label ?? 'then'}
                    </p>
                  </div>
                )}
              </li>
            );
          })}
        </ol>

        {offPath.length > 0 && (
          <section className="mt-8">
            <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-400">
              Branches off the main path
            </h2>
            <div className="mt-3 space-y-2">
              {offPath.map((node) => (
                <button
                  key={node.id}
                  type="button"
                  onClick={() => navigate(`/pack/${pack.id}/map/${node.id}`)}
                  className="w-full rounded-xl bg-slate-50 p-3 text-left ring-1 ring-slate-200 active:scale-[0.99] transition"
                >
                  <span className="text-sm font-medium text-slate-800">{node.label}</span>
                  <KindBadge kind={node.kind} />
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
                  <p className="text-sm font-medium text-slate-900">{fm.symptom}</p>
                  <p className="mt-2 text-sm text-slate-600">
                    <span className="font-medium text-slate-700">Cause: </span>
                    {fm.cause}
                  </p>
                  <p className="mt-1 text-sm text-slate-600">
                    <span className="font-medium text-slate-700">Fix: </span>
                    {fm.resolution}
                  </p>
                  <CitationList citations={fm.citations} />
                </div>
              ))}
            </div>
          </section>
        )}
      </div>

      {selected && (
        <NodeDetail node={selected} onClose={() => navigate(`/pack/${pack.id}/map`)} />
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

/**
 * Step detail. The order of the sections is deliberate: what it is, then why
 * it exists, then what breaks without it. The last two are the reason this app
 * exists — a learner who can recite the sequence but cannot answer them has
 * memorised rather than understood.
 */
function NodeDetail({ node, onClose }: { node: ProcessNode; onClose: () => void }) {
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

        <Section title="What it is" body={node.what} />
        <Section title="Why it exists" body={node.why} accent="blue" />
        <Section title="What breaks without it" body={node.breaksIf} accent="rose" />

        {node.configPath && (
          <div className="mt-4">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-400">
              Where to configure it
            </h3>
            <p className="mt-1 rounded-lg bg-slate-50 p-3 font-mono text-xs text-slate-700 ring-1 ring-slate-200">
              {node.configPath}
            </p>
          </div>
        )}

        {node.tcodes && node.tcodes.length > 0 && (
          <div className="mt-4 flex flex-wrap gap-1.5">
            {node.tcodes.map((t) => (
              <span key={t} className="rounded bg-slate-100 px-2 py-1 font-mono text-xs text-slate-700">
                {t}
              </span>
            ))}
          </div>
        )}

        <CitationList citations={node.citations} />
      </div>
    </div>
  );
}

function Section({
  title,
  body,
  accent,
}: {
  title: string;
  body: string;
  accent?: 'blue' | 'rose';
}) {
  const tone =
    accent === 'blue'
      ? 'bg-blue-50 ring-blue-100 text-blue-950'
      : accent === 'rose'
        ? 'bg-rose-50 ring-rose-100 text-rose-950'
        : 'bg-slate-50 ring-slate-200 text-slate-700';
  return (
    <div className="mt-4">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-400">{title}</h3>
      <p className={`mt-1 rounded-lg p-3 text-sm ring-1 ${tone}`}>{body}</p>
    </div>
  );
}
