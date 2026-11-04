import { z } from 'zod';

export type SchemaProfile = 'default' | 'strict' | 'compact';

export type JsonSchema = Record<string, unknown>;

/**
 * Generates JSON Schema from zod with a provider compatibility profile (spec §14.6):
 * - `default`: plain JSON Schema (draft 2020-12).
 * - `strict`: every property required, optional ones as `T | null`, `additionalProperties: false`
 *   (needed by strict tool modes of some providers). Pair with {@link stripNulls} on input.
 * - `compact`: removes long descriptions and examples to save context.
 */
export function toJsonSchema(schema: z.ZodType, profile: SchemaProfile = 'default'): JsonSchema {
  const json = z.toJSONSchema(schema, {
    io: 'input',
    unrepresentable: 'any',
    target: 'draft-2020-12',
  }) as JsonSchema;
  delete json.$schema;
  if (profile === 'strict') return strictify(json);
  if (profile === 'compact') return compact(json);
  return json;
}

function strictify(node: unknown): JsonSchema {
  if (Array.isArray(node)) return node.map(strictify) as unknown as JsonSchema;
  if (node === null || typeof node !== 'object') return node as JsonSchema;
  const out: JsonSchema = {};
  for (const [key, value] of Object.entries(node)) {
    if (key === 'properties' && value && typeof value === 'object') {
      const props: JsonSchema = {};
      for (const [prop, propSchema] of Object.entries(value)) props[prop] = strictify(propSchema);
      out.properties = props;
    } else if (key === 'default') {
      // Strict modes reject defaults; the value is applied by zod on parse anyway.
    } else {
      out[key] = typeof value === 'object' ? strictify(value) : value;
    }
  }
  if (out.type === 'object' && out.properties && typeof out.properties === 'object') {
    const props = out.properties as Record<string, JsonSchema>;
    const required = new Set<string>(Array.isArray(out.required) ? (out.required as string[]) : []);
    for (const [prop, propSchema] of Object.entries(props)) {
      if (!required.has(prop)) props[prop] = { anyOf: [propSchema, { type: 'null' }] };
    }
    out.required = Object.keys(props);
    out.additionalProperties = false;
  }
  return out;
}

function compact(node: unknown): JsonSchema {
  if (Array.isArray(node)) return node.map(compact) as unknown as JsonSchema;
  if (node === null || typeof node !== 'object') return node as JsonSchema;
  const out: JsonSchema = {};
  for (const [key, value] of Object.entries(node)) {
    if (key === 'examples') continue;
    if (key === 'description' && typeof value === 'string' && value.length > 80) continue;
    if (key === 'properties' && value && typeof value === 'object') {
      const props: JsonSchema = {};
      for (const [prop, propSchema] of Object.entries(value)) props[prop] = compact(propSchema);
      out.properties = props;
      continue;
    }
    out[key] = typeof value === 'object' ? compact(value) : value;
  }
  return out;
}

/** Removes `null` values produced by the strict profile, turning them back into absent optionals. */
export function stripNulls<T>(value: T): T {
  if (Array.isArray(value)) return value.map(stripNulls) as T;
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) {
      if (item === null) continue;
      out[key] = stripNulls(item);
    }
    return out as T;
  }
  return value;
}
