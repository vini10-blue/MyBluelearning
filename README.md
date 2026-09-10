# MyBlueLearning

Process-first study for SAP modules and IT certifications. A PWA that teaches
you how a process works, not what its flashcards say.

## Why it is built this way

The design constraint is that the goal is **understanding processes, not
memorising facts**. SAP knowledge is process knowledge — document flows,
decision points, integration boundaries, failure modes. A flashcard tool can
hold "what is T-code /SCWM/PRDI"; it cannot hold a branching scenario, a
process graph, or a graded free-text explanation. That gap is the only reason
this is a custom app rather than an Anki deck.

The instructional method is **4C/ID** (van Merriënboer), the best-evidenced
framework for complex process-skill acquisition. Its four components map to
four modes, plus a fifth that only an LLM makes possible:

| 4C/ID component | Mode | Purpose |
|---|---|---|
| Supportive information | **Map** | The process as a graph. Each step answers what it is, *why it exists*, and *what breaks without it*. |
| Procedural information | **Walkthrough** | Narrated worked example, audio-first so it works in phone dead time. Steps fade out on repeat. |
| Learning tasks | **Drills** | Whole-task practice with scaffolding removed progressively. The game layer. |
| Part-task practice | **Review** | FSRS-scheduled automation of recurrent detail. Deliberately secondary. |
| — | **Explain** | You explain; Claude grades against the source text with a rubric, names the gap, and generates a drill for it. |

Drills are Sequence-it, Trace-it, Break-it and Configure-it. They are
deliberate practice rather than trivia, and Break-it/Configure-it deliberately
mirror the scenario-based format the EWM certification itself now uses.

## The accuracy guard

SAP specifics — T-codes, config paths, table and object names — are exactly
where a model produces plausible-but-wrong content. A wrong item inside a
spaced-repetition schedule does not merely fail to teach; it drills the error
until it feels true.

So every node, edge and item must cite a source that resolves to a document
the pack declares, with a verbatim quote, and an explicit `verified` flag.
Anything that cannot is **dropped at ingest**, not flagged for later. A
citation with a missing flag is treated as malformed rather than as
unverified, because defaulting it would silently launder unchecked content.

### Verification is mechanical, not self-reported

At ingest the model is asked to copy a **verbatim quote** from the chunk it
cites. The server then checks that the quote is actually there and sets
`verified` itself — the schema never gives the model a field to assert it with,
and on a verified quote the chunk's own locator and URL overwrite whatever the
model supplied (it is a reliable copier of text and an unreliable source of
metadata).

The check is a strict substring match after normalising the things that are
copying artifacts rather than meaning: curly quotes, non-breaking spaces, soft
hyphens, ragged whitespace, case. A paraphrase is not a quote. There is also a
minimum quote length, because without one a model could "verify" anything by
quoting a single common word.

Anthropic's native citations feature cannot be used here — it returns a 400 when
combined with structured outputs — so this is not merely the better option, it
is the only one.

`npm run check` runs the typecheck plus both harnesses: `check:pack` for the
guard, `check:quotes` for verification (including the cases that would defeat
it — paraphrase, trivially short quotes, real text attributed to the wrong
document).

Unverified citations render with amber chrome and an explicit label, because a
citation carrying a real SAP URL and an invented quote is more dangerous than
an obviously missing one — it reads as authority.

## Current state

Built:

- The chassis, ported from `expenses-app`: MSAL auth, PWA lifecycle and update
  prompt, the verified-token + rate-limited serverless pattern, storage helpers.
- Real routing (deep links, working back button), unlike the phase union in
  `expenses-app`.
- The domain model (`src/lib/types.ts`) and the accuracy guard
  (`src/lib/validateCoursePack.ts`), with a passing verification harness.
- **Map** mode for the EWM inbound slice.

- **Ingest, pass 1** — `api/ingest.ts` builds a process model from a SAP Help
  Portal page, with every citation settled mechanically against the source
  text. Source fetching is allowlisted to `help.sap.com` (the origin comes from
  the client, so without that this endpoint would fetch arbitrary URLs using
  the server's network position).

Not built: Walkthrough, the four drills, Explain, the FSRS review queue, ingest
pass 2 (item generation), and PDF ingest. The unbuilt routes exist and say
plainly that they are not implemented rather than showing plausible-looking
placeholder content.

**Untestable locally:** `help.sap.com` is blocked by the development
environment's egress proxy, so the fetch path in `api/_sources.ts` has never
run against the real host. Everything downstream of the fetch — chunking, quote
verification, the guard — is covered by the harnesses. First job on a preview
deploy is to run ingest against a real Help Portal page.

### The seed pack is a fixture, not study material

`src/content/seedPack.ts` covers EWM inbound (goods receipt → putaway). Every
citation in it is `verified: false`, for two reasons: the quotes were relayed
through a web-search summary rather than read from the SAP Help pages
(help.sap.com is blocked by the development environment's egress proxy), and
the `why` / `breaksIf` reasoning on each node is model-authored inference. Read
it to judge the format, not to learn the facts. First real task after deploy:
re-ingest from the live Help Portal and let the generated pack replace it.

## Setup

```bash
npm install
cp .env.example .env.local   # fill in a NEW Entra app registration
npm run dev
```

Register a **separate** Entra app rather than reusing the expenses app's — a
shared registration means a compromise of either app reaches the other's
OneDrive scope.

## Scripts

- `npm run dev` — local Vite
- `npm run typecheck` — `tsc -b --noEmit`, covers `src`, `api`, `scripts` and the vite config
- `npm run check` — typecheck plus both verification harnesses
- `npm run check:pack` — the accuracy-guard harness
- `npm run check:quotes` — the citation-verification harness
- `npm run build` — `tsc -b && vite build`
- `node scripts/generate-icons.mjs` — regenerate PWA icons from `scripts/icon.svg`

## Storage

Course packs and progress are JSON on OneDrive via Microsoft Graph, so phone
and laptop sync without running a database. The serverless functions never hold
Graph credentials — ingest returns the pack and the browser uploads it with its
own token. Graph responses are deliberately
*not* runtime-cached in the service worker — they carry a short-lived bearer
token, so caching them would either leak authenticated content or serve
expired responses.
