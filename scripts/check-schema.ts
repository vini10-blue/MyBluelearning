/**
 * Lint the structured-output schemas against what the API actually accepts.
 *
 * Run with: npm run check:schema
 *
 * The first real ingest against a live SAP page failed with a 400 from the
 * model API: the schema used `minItems`, which structured outputs do not
 * support. Nothing caught it because no harness ever looked at the schema —
 * check-pipeline feeds generation-shaped JSON straight into settling, so the
 * schema itself was the one surface with zero coverage. This closes that.
 *
 * The rules come from the API's documented JSON Schema subset: basic types,
 * enum / const / anyOf / allOf / $ref, a fixed list of string formats, and
 * `additionalProperties: false` required on every object. Numeric, string
 * and array constraints are rejected.
 */
import { ITEMS_SCHEMA, PROCESS_SCHEMA } from '../api/ingest.js';

const BANNED = new Set([
  'minItems', 'maxItems', 'uniqueItems', 'contains',
  'minimum', 'maximum', 'exclusiveMinimum', 'exclusiveMaximum', 'multipleOf',
  'minLength', 'maxLength', 'pattern',
  'default', 'minProperties', 'maxProperties', 'patternProperties', 'not', 'if', 'then', 'else',
]);
const ALLOWED_FORMATS = new Set([
  'date-time', 'time', 'date', 'duration', 'email', 'hostname', 'uri', 'ipv4', 'ipv6', 'uuid',
]);

let failures = 0;
function fail(path: string, msg: string) {
  failures += 1;
  console.log(`  ✗ ${path}: ${msg}`);
}

let currentDefs: Record<string, unknown> = {};

function walk(node: unknown, path: string, seen: Set<unknown>) {
  if (!node || typeof node !== 'object') return;
  // A reference is a leaf: it must point at an existing $defs entry, and the
  // target is linted once where it is defined, not at every use.
  const ref = (node as Record<string, unknown>).$ref;
  if (typeof ref === 'string') {
    const m = /^#\/\$defs\/([A-Za-z0-9_]+)$/.exec(ref);
    if (!m || !(m[1] in currentDefs)) fail(`${path}.$ref`, `unresolvable reference "${ref}"`);
    return;
  }
  if (seen.has(node)) {
    fail(path, 'recursive schema reference');
    return;
  }
  seen.add(node);
  const obj = node as Record<string, unknown>;

  for (const key of Object.keys(obj)) {
    if (BANNED.has(key)) fail(`${path}.${key}`, 'unsupported keyword');
  }
  if (typeof obj.format === 'string' && !ALLOWED_FORMATS.has(obj.format)) {
    fail(`${path}.format`, `unsupported format "${obj.format}"`);
  }
  if (obj.type === 'object') {
    if (obj.additionalProperties !== false) {
      fail(path, 'object without additionalProperties: false');
    }
    const props = (obj.properties ?? {}) as Record<string, unknown>;
    // Every property must be listed in `required`. Optional fields are
    // expressed as required-but-nullable (anyOf with null), the pattern the
    // expenses app's working schema uses throughout.
    const required = new Set(Array.isArray(obj.required) ? (obj.required as string[]) : []);
    for (const k of Object.keys(props)) {
      if (!required.has(k)) fail(`${path}.${k}`, 'property not listed in required');
    }
    for (const [k, v] of Object.entries(props)) walk(v, `${path}.${k}`, seen);
  }
  if (obj.type === 'array') walk(obj.items, `${path}[]`, seen);
  for (const combinator of ['anyOf', 'allOf', 'oneOf']) {
    const list = obj[combinator];
    if (Array.isArray(list)) list.forEach((v, i) => walk(v, `${path}.${combinator}[${i}]`, seen));
  }
  seen.delete(node);
}

// Only the two schemas that are sent as requests. Shared shapes are linted
// through each root's $defs — a fragment on its own has nothing to resolve
// its $ref against, so linting it standalone would be a false failure.
const schemas: Record<string, unknown> = { PROCESS_SCHEMA, ITEMS_SCHEMA };
function lintRoot(name: string, schema: unknown) {
  const before = failures;
  const root = schema as Record<string, unknown>;
  currentDefs = (root.$defs ?? {}) as Record<string, unknown>;
  for (const [k, v] of Object.entries(currentDefs)) walk(v, `${name}.$defs.${k}`, new Set());
  walk(schema, name, new Set());
  const bytes = JSON.stringify(schema).length;
  if (failures === before) console.log(`  ✓ ${name} (${bytes} bytes)`);
  currentDefs = {};
}

for (const [name, schema] of Object.entries(schemas)) lintRoot(name, schema);

// The lint must be able to fail, or it proves nothing. Feed it the exact
// shape that broke the first real ingest and require it to object.
{
  const before = failures;
  const log = console.log;
  console.log = () => {};
  walk(
    { type: 'object', additionalProperties: false, required: ['citations'],
      properties: { citations: { type: 'array', items: { type: 'string' }, minItems: 1 } } },
    'SELF_TEST', new Set(),
  );
  console.log = log;
  const caught = failures - before;
  failures = before;
  if (caught === 1) console.log('  ✓ self-test: the lint rejects minItems');
  else fail('SELF_TEST', `expected 1 rejection for minItems, got ${caught}`);
}

// A dangling $ref must be rejected too — it would compile to nothing.
{
  const before = failures;
  const log = console.log;
  console.log = () => {};
  lintRoot('SELF_TEST_REF', {
    $defs: {},
    type: 'object', additionalProperties: false, required: ['x'],
    properties: { x: { $ref: '#/$defs/missing' } },
  });
  console.log = log;
  const caught = failures - before;
  failures = before;
  if (caught === 1) console.log('  ✓ self-test: the lint rejects a dangling $ref');
  else fail('SELF_TEST_REF', `expected 1 rejection for a dangling $ref, got ${caught}`);
}

console.log(failures === 0 ? '\nAll schema checks passed.\n' : `\n${failures} schema problem(s).\n`);
process.exit(failures === 0 ? 0 : 1);
