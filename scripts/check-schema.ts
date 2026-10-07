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
import {
  CITATION_SCHEMA,
  CHOICES_SCHEMA,
  ITEMS_SCHEMA,
  PROCESS_SCHEMA,
  SOURCED_CLAIM_SCHEMA,
  SYNTHESIS_SCHEMA,
} from '../api/ingest.js';

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

function walk(node: unknown, path: string, seen: Set<unknown>) {
  if (!node || typeof node !== 'object') return;
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
    for (const [k, v] of Object.entries(props)) walk(v, `${path}.${k}`, seen);
  }
  if (obj.type === 'array') walk(obj.items, `${path}[]`, seen);
  for (const combinator of ['anyOf', 'allOf', 'oneOf']) {
    const list = obj[combinator];
    if (Array.isArray(list)) list.forEach((v, i) => walk(v, `${path}.${combinator}[${i}]`, seen));
  }
  seen.delete(node);
}

const schemas: Record<string, unknown> = {
  CITATION_SCHEMA, SOURCED_CLAIM_SCHEMA, SYNTHESIS_SCHEMA, PROCESS_SCHEMA, CHOICES_SCHEMA, ITEMS_SCHEMA,
};
for (const [name, schema] of Object.entries(schemas)) {
  const before = failures;
  walk(schema, name, new Set());
  if (failures === before) console.log(`  ✓ ${name}`);
}

// The lint must be able to fail, or it proves nothing. Feed it the exact
// shape that broke the first real ingest and require it to object.
{
  const before = failures;
  const log = console.log;
  console.log = () => {};
  walk(
    { type: 'object', additionalProperties: false,
      properties: { citations: { type: 'array', items: { type: 'string' }, minItems: 1 } } },
    'SELF_TEST', new Set(),
  );
  console.log = log;
  const caught = failures - before;
  failures = before;
  if (caught === 1) console.log('  ✓ self-test: the lint rejects minItems');
  else fail('SELF_TEST', `expected 1 rejection for minItems, got ${caught}`);
}

console.log(failures === 0 ? '\nAll schema checks passed.\n' : `\n${failures} schema problem(s).\n`);
process.exit(failures === 0 ? 0 : 1);
