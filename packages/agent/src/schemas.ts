import {
  type AnyFormatAdapter,
  type ArtifactRegistry,
  envelopeOperationSchema,
  localeSchema,
} from '@artkit-ai/core';
import { z } from 'zod';

/**
 * Tool input schemas (spec §15.1). Each tool has the zod schema the model is asked to produce; scope never appears
 * here, so workspace and user ids can only come from the execution context.
 */
export const idSchema = z
  .string()
  .min(1)
  .max(128)
  .describe('Artifact id, exactly as returned by a previous tool call.');
const versionSchema = z
  .number()
  .int()
  .min(1)
  .describe('Version the batch was computed against (the last version you read).');

function nonEmpty(values: readonly string[], what: string): [string, ...string[]] {
  if (values.length === 0) throw new Error(`@artkit-ai/agent: no ${what} available to build tool schemas.`);
  return values as [string, ...string[]];
}

/** Operations accepted by one format (its own discriminated union). */
export function operationsOf(adapter: AnyFormatAdapter): z.ZodType {
  return z
    .array(adapter.operationSchema)
    .min(1)
    .max(200)
    .describe(`${adapter.label} operations, applied in order.`);
}

/** Operations of every enabled format: the envelope operations plus the union of each format's own operations. */
export function unionOperations(adapters: AnyFormatAdapter[]): z.ZodType {
  const all = [envelopeOperationSchema, ...adapters.map((adapter) => adapter.operationSchema)];
  return z
    .array(z.union(all as unknown as [z.ZodType, z.ZodType, ...z.ZodType[]]))
    .min(1)
    .max(200)
    .describe('Operations, applied in order.');
}

export function createSchema(formats: string[]) {
  return z.object({
    format: z.enum(nonEmpty(formats, 'formats')).describe('Native format of the artifact.'),
    title: z.string().min(1).max(200),
    content: z
      .union([z.string(), z.record(z.string(), z.unknown())])
      .optional()
      .describe('Native content: Markdown or OpenUI Lang text, or a workbook object.'),
    operations: z
      .array(z.record(z.string(), z.unknown()))
      .max(200)
      .optional()
      .describe('Initial batch applied on the empty content (e.g. the first sheet operations).'),
    locale: localeSchema.optional(),
    themeId: z.string().min(1).max(64).optional(),
    tags: z.array(z.string().max(64)).max(32).optional(),
  });
}

export function readSchema(maxTokensCap: number) {
  return z.object({
    id: idSchema,
    mode: z
      .enum(['outline', 'section', 'statements', 'range', 'full'])
      .default('outline')
      .describe('Reading mode of the format.'),
    range: z
      .string()
      .max(200)
      .optional()
      .describe('Anchors, A1 range or declaration names, depending on the format.'),
    maxTokens: z.number().int().min(200).max(maxTokensCap).optional(),
    cursor: z.string().max(64).optional(),
  });
}

export function applySchema(adapters: AnyFormatAdapter[], perFormat?: AnyFormatAdapter) {
  const operations = perFormat ? operationsOf(perFormat) : unionOperations(adapters);
  return z.object({
    id: idSchema,
    baseVersion: versionSchema,
    operations,
  });
}

export function exportSchema(targets: string[]) {
  return z.object({
    id: idSchema,
    target: z
      .enum(nonEmpty(targets, 'export targets'))
      .describe('File format to produce, e.g. xlsx, docx, pptx, html.'),
  });
}

export function listSchema(formats: string[]) {
  return z.object({
    format: z.enum(nonEmpty(formats, 'formats')).optional(),
    title: z.string().max(200).optional(),
    limit: z.number().int().min(1).max(100).default(20),
    cursor: z.string().max(256).optional(),
  });
}

export function guideSchema(topics: string[]) {
  return z.object({
    topic: z
      .enum(nonEmpty(topics, 'guide topics'))
      .describe('Guide topic: a format, "overview", "themes" or "errors".'),
  });
}

export type ToolInputSchema = z.ZodType;

export function registeredFormats(registry: ArtifactRegistry): AnyFormatAdapter[] {
  return registry.formats();
}
