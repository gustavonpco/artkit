import {
  type AnyArtifactKind,
  ARTIFACT_STATUSES,
  type ArtifactRegistry,
  envelopeOperationSchema,
  localeSchema,
} from '@artkit-ai/core';
import { z } from 'zod';

/**
 * Tool input schemas. Each tool has two zod schemas:
 * - `model`: what the model sees (JSON Schema per profile), e.g. the operation union of the enabled kinds;
 * - `parse`: what the handler validates before calling the service. It is deliberately looser where the core
 *   gives better, kind-aware errors (operations and content are validated by the engine with exact paths).
 * Neither declares workspace or user fields: extra keys are stripped, so scope can only come from context.
 */

// Ids are opaque: stores other than the memory store may not use the `art_` + ULID format.
export const idSchema = z
  .string()
  .min(1)
  .max(128)
  .describe('Artifact id, exactly as returned by a previous tool call.');

const versionSchema = z.number().int().min(1);
const messageSchema = z.string().max(500);

function nonEmptyEnum(values: string[], what: string): z.ZodEnum<Record<string, string>> {
  if (values.length === 0) throw new Error(`@artkit-ai/agent: no ${what} available to build tool schemas.`);
  return z.enum(values as [string, ...string[]]);
}

/** Flattens discriminated unions so the JSON Schema has one `anyOf` level (friendlier to strict providers). */
export function operationVariants(schema: z.ZodType): z.ZodType[] {
  const options = (schema as unknown as { options?: z.ZodType[] }).options;
  return Array.isArray(options) && options.length > 0 ? options : [schema];
}

export function operationsUnion(kinds: AnyArtifactKind[]): z.ZodType {
  const variants = [
    ...operationVariants(envelopeOperationSchema),
    ...kinds.flatMap((kind) => operationVariants(kind.operationSchema)),
  ];
  return z.union(variants as [z.ZodType, z.ZodType, ...z.ZodType[]]);
}

export interface ToolSchemas {
  model: z.ZodType;
  parse: z.ZodType;
}

export function createSchemas(registry: ArtifactRegistry, kinds: AnyArtifactKind[]): ToolSchemas {
  const kindEnum = nonEmptyEnum(
    kinds.map((kind) => kind.kind),
    'kinds',
  ).describe('Artifact kind.');
  const formats = [...new Set(kinds.flatMap((kind) => Object.keys(kind.inputs ?? {})))];
  const themeIds = registry.themes().map((theme) => theme.id);
  const shape = {
    kind: kindEnum,
    title: z.string().min(1).max(200).describe('Short title shown to the user.'),
    content: z
      .unknown()
      .optional()
      .describe(
        'Full content as JSON following the kind fields in the instructions. Omit to start from an empty skeleton or when using input.',
      ),
    ...(formats.length > 0
      ? {
          input: z
            .object({
              format: nonEmptyEnum(formats, 'input formats').describe('Source format accepted by the kind.'),
              source: z.unknown().describe('Source text (Markdown, Mermaid, CSV) or table rows.'),
            })
            .optional()
            .describe('Alternative to content: create from a source format.'),
        }
      : {}),
    locale: localeSchema.optional(),
    themeId: nonEmptyEnum(themeIds, 'themes').optional().describe('Theme id; omit for the default theme.'),
  };
  // Kind and format are re-checked by the service, which answers with UNKNOWN_KIND / format hints.
  const parse = z.object({
    ...shape,
    kind: z.string().min(1).max(64),
    input: z.object({ format: z.string().min(1).max(64), source: z.unknown() }).optional(),
    themeId: z.string().min(1).max(64).optional(),
  });
  return { model: z.object(shape), parse };
}

export function readSchema(maxTokensCap: number): ToolSchemas {
  const schema = z.object({
    id: idSchema,
    mode: z
      .enum(['outline', 'full', 'range'])
      .default('outline')
      .describe('outline: ids and one line per item; full: everything; range: only `range`.'),
    range: z
      .string()
      .max(200)
      .optional()
      .describe(
        'Item ids ("intro..scope"), positions ("3-5"), A1 ranges or a group id, depending on the kind.',
      ),
    maxTokens: z
      .number()
      .int()
      .min(100)
      .max(maxTokensCap)
      .optional()
      .describe('Token budget; the text is cut at an item boundary and a cursor is returned.'),
    cursor: z.string().max(200).optional().describe('Cursor returned by a truncated read.'),
    version: versionSchema.optional().describe('Read an older version; omit for the latest.'),
  });
  return { model: schema, parse: schema };
}

export function applySchemas(registry: ArtifactRegistry, kinds: AnyArtifactKind[]): ToolSchemas {
  const base = {
    id: idSchema,
    baseVersion: versionSchema.describe('The latest version returned for this artifact.'),
    message: messageSchema.optional().describe('Short change description for the history.'),
  };
  const model = z.object({
    ...base,
    operations: z
      .array(operationsUnion(kinds))
      .min(1)
      .max(registry.batch.maxOperations)
      .describe('Operations applied atomically, in order. Reference items by id.'),
  });
  // The engine validates operations against the artifact's own kind and reports exact paths and hints.
  const parse = z.object({ ...base, operations: z.array(z.unknown()) });
  return { model, parse };
}

export function exportSchema(formats: string[]): ToolSchemas {
  const schema = z.object({
    id: idSchema,
    format: nonEmptyEnum(formats, 'export formats').describe('File format.'),
    version: versionSchema.optional().describe('Export an older version; omit for the latest.'),
  });
  return { model: schema, parse: schema };
}

export function listSchema(kinds: AnyArtifactKind[]): ToolSchemas {
  const schema = z.object({
    kind: nonEmptyEnum(
      kinds.map((kind) => kind.kind),
      'kinds',
    )
      .optional()
      .describe('Only this kind.'),
    status: z.enum(ARTIFACT_STATUSES).optional(),
    title: z.string().max(200).optional().describe('Case-insensitive part of the title.'),
    limit: z.number().int().min(1).max(50).default(20),
    cursor: z.string().max(200).optional().describe('nextCursor from the previous page.'),
  });
  return { model: schema, parse: schema };
}

export function submitSchema(): ToolSchemas {
  const schema = z.object({
    id: idSchema,
    message: messageSchema.optional().describe('Note for the reviewer.'),
  });
  return { model: schema, parse: schema };
}

export function guideSchema(topics: string[]): ToolSchemas {
  const schema = z.object({ topic: nonEmptyEnum(topics, 'guide topics').describe('Guide topic.') });
  // Unknown topics get a model-facing error listing the valid ones instead of a bare enum failure.
  return { model: schema, parse: z.object({ topic: z.string().min(1).max(64) }) };
}
