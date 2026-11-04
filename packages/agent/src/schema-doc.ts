import { envelopeOperationSchema, type JsonSchema, toJsonSchema } from '@artkit-ai/core';
import type { z } from 'zod';

/**
 * Renders JSON Schema as compact Markdown so guides and instructions never hand-write field lists
 * (spec §14.7: the technical parts are always generated).
 */

type Node = JsonSchema;

function isObject(value: unknown): value is Node {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function resolve(node: unknown, root: Node): Node {
  if (!isObject(node)) return {};
  const ref = node.$ref;
  if (typeof ref === 'string' && ref.startsWith('#/')) {
    let target: unknown = root;
    for (const segment of ref.slice(2).split('/')) target = isObject(target) ? target[segment] : undefined;
    return isObject(target) ? { ...target, ...withoutRef(node) } : {};
  }
  return node;
}

function withoutRef(node: Node): Node {
  const { $ref: _ref, ...rest } = node;
  return rest;
}

function variants(node: Node): Node[] | undefined {
  const list = node.anyOf ?? node.oneOf;
  return Array.isArray(list) ? (list as Node[]) : undefined;
}

function range(node: Node, min: string, max: string): string {
  const lo = node[min];
  const hi = node[max];
  if (typeof lo === 'number' && typeof hi === 'number') return ` ${lo}–${hi}`;
  if (typeof lo === 'number') return ` ≥ ${lo}`;
  if (typeof hi === 'number') return ` ≤ ${hi}`;
  return '';
}

/** One-line type label: `string`, `integer 1–100`, `"a" | "b"`, `array of object (≤ 200)`. */
export function typeLabel(raw: unknown, root: Node, depth = 0): string {
  const node = resolve(raw, root);
  if (depth > 4) return '…';
  if (Array.isArray(node.enum)) return node.enum.map((value) => JSON.stringify(value)).join(' | ');
  if ('const' in node) return JSON.stringify(node.const);
  const options = variants(node);
  if (options) {
    const labels = [...new Set(options.map((option) => typeLabel(option, root, depth + 1)))];
    return labels.join(' | ');
  }
  const type = node.type;
  if (Array.isArray(type)) return type.join(' | ');
  switch (type) {
    case 'string': {
      const format = typeof node.format === 'string' ? ` (${node.format})` : '';
      const length = range(node, 'minLength', 'maxLength');
      return `string${format}${length ? ` (length${length})` : ''}`;
    }
    case 'number':
    case 'integer':
      return `${type}${range(node, 'minimum', 'maximum')}`;
    case 'boolean':
    case 'null':
      return type;
    case 'array': {
      const items = typeLabel(node.items, root, depth + 1);
      const count = range(node, 'minItems', 'maxItems');
      return `array of ${items}${count ? ` (items${count})` : ''}`;
    }
    case 'object':
      return 'object';
    default:
      return 'any';
  }
}

function description(node: Node): string {
  return typeof node.description === 'string' ? node.description.replace(/\s+/g, ' ').trim() : '';
}

function objectOf(raw: unknown, root: Node): Node | undefined {
  const node = resolve(raw, root);
  if (node.type === 'object' && isObject(node.properties)) return node;
  if (node.type === 'array') return objectOf(node.items, root);
  return undefined;
}

/** Bullet list of the properties of an object schema, recursing into nested objects up to `maxDepth`. */
export function renderFields(
  raw: unknown,
  root: Node,
  options: { maxDepth?: number; skip?: string[]; indent?: string } = {},
): string[] {
  const maxDepth = options.maxDepth ?? 3;
  const indent = options.indent ?? '';
  const node = resolve(raw, root);
  const props = isObject(node.properties) ? (node.properties as Record<string, unknown>) : {};
  const required = new Set(Array.isArray(node.required) ? (node.required as string[]) : []);
  const lines: string[] = [];
  for (const [name, schema] of Object.entries(props)) {
    if (options.skip?.includes(name)) continue;
    const child = resolve(schema, root);
    const text = description(child);
    lines.push(
      `${indent}- \`${name}\` (${typeLabel(child, root)}${required.has(name) ? ', required' : ''})${text ? `: ${text}` : ''}`,
    );
    if (maxDepth <= 1) continue;
    const nestedVariants = variants(child.type === 'array' ? resolve(child.items, root) : child);
    if (nestedVariants?.some((variant) => objectOf(variant, root))) {
      for (const variant of nestedVariants) {
        const object = objectOf(variant, root);
        if (!object) continue;
        const discriminator = discriminatorOf(object, root);
        lines.push(`${indent}  - variant${discriminator ? ` ${discriminator}` : ''}:`);
        lines.push(
          ...renderFields(object, root, {
            maxDepth: maxDepth - 1,
            indent: `${indent}    `,
            skip: discriminatorKey(object, root),
          }),
        );
      }
      continue;
    }
    const nested = objectOf(child, root);
    if (nested) lines.push(...renderFields(nested, root, { maxDepth: maxDepth - 1, indent: `${indent}  ` }));
  }
  return lines;
}

function discriminatorKey(object: Node, root: Node): string[] {
  const props = isObject(object.properties) ? (object.properties as Record<string, unknown>) : {};
  for (const [name, schema] of Object.entries(props)) {
    const child = resolve(schema, root);
    if ('const' in child || (Array.isArray(child.enum) && child.enum.length === 1)) return [name];
  }
  return [];
}

function discriminatorOf(object: Node, root: Node): string | undefined {
  const [key] = discriminatorKey(object, root);
  if (!key) return undefined;
  const child = resolve((object.properties as Record<string, unknown>)[key], root);
  const value = 'const' in child ? child.const : (child.enum as unknown[])[0];
  return `\`${key}: ${JSON.stringify(value)}\``;
}

export interface OperationDoc {
  op: string;
  description: string;
  fields: string[];
}

/** Lists each `op` of a discriminated operation union with its fields. */
export function describeOperations(schema: z.ZodType, options: { maxDepth?: number } = {}): OperationDoc[] {
  const json = toJsonSchema(schema);
  const list = variants(json) ?? [json];
  const docs: OperationDoc[] = [];
  for (const raw of list) {
    const node = resolve(raw, json);
    const opSchema = isObject(node.properties)
      ? resolve((node.properties as Record<string, unknown>).op, json)
      : {};
    const op =
      typeof opSchema.const === 'string'
        ? opSchema.const
        : Array.isArray(opSchema.enum)
          ? String(opSchema.enum[0])
          : undefined;
    if (!op) continue;
    docs.push({
      op,
      description: description(node),
      fields: renderFields(node, json, { skip: ['op'], maxDepth: options.maxDepth ?? 2 }),
    });
  }
  return docs;
}

export function describeEnvelopeOperations(): OperationDoc[] {
  return describeOperations(envelopeOperationSchema, { maxDepth: 1 });
}

/** Field list of a content schema. */
export function describeContent(schema: z.ZodType, options: { maxDepth?: number } = {}): string[] {
  const json = toJsonSchema(schema);
  const object = objectOf(json, json);
  if (!object) return [`- ${typeLabel(json, json)}`];
  return renderFields(object, json, { maxDepth: options.maxDepth ?? 3 });
}

export function renderOperation(doc: OperationDoc, heading = '###'): string {
  const lines = [`${heading} \`${doc.op}\``];
  if (doc.description) lines.push('', doc.description);
  lines.push('', ...(doc.fields.length > 0 ? doc.fields : ['- (no fields besides `op`)']));
  return lines.join('\n');
}
