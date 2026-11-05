import { z } from 'zod';
import { artifactIdSchema } from './ids.js';

export const actorSchema = z.object({
  type: z.enum(['agent', 'user', 'system']),
  id: z.string().min(1).max(128),
});
export type Actor = z.infer<typeof actorSchema>;

export const titleSchema = z.string().trim().min(1).max(200).describe('Artifact title, 1 to 200 characters.');

// BCP-47 language tag, permissive (language, optional script/region/variants).
export const localeSchema = z
  .string()
  .regex(/^[a-zA-Z]{2,3}(-[a-zA-Z0-9]{2,8})*$/, 'Use a BCP-47 tag such as "pt-BR" or "en-US".')
  .describe('BCP-47 locale tag; drives number, date and currency formatting.');

export const metaSchema = z.object({
  createdAt: z.string(),
  updatedAt: z.string(),
  createdBy: actorSchema,
  updatedBy: actorSchema,
  tags: z.array(z.string().max(64)).max(32).default([]),
});
export type ArtifactMeta = z.infer<typeof metaSchema>;

/**
 * Envelope. Only `content` is produced by the model; everything else is system-owned. The library keeps the current
 * content and a `version` counter for optimistic concurrency. It keeps no history: saving and versioning belong to the
 * harness, which receives the save action from the editor (see `onSave` in `@artkit-ai/react`).
 */
export const envelopeSchema = z.object({
  id: artifactIdSchema,
  format: z.string().min(1).max(64),
  formatVersion: z.string().min(1).max(64),
  version: z.number().int().min(1),
  title: titleSchema,
  locale: localeSchema,
  themeId: z.string().min(1).max(64),
  content: z.unknown(),
  meta: metaSchema,
});

export interface Artifact<Content = unknown> {
  id: string;
  format: string;
  formatVersion: string;
  version: number;
  title: string;
  locale: string;
  themeId: string;
  content: Content;
  meta: ArtifactMeta;
}

/** Lightweight reference carried in chat messages and lists (no content). */
export interface ArtifactSummary {
  id: string;
  format: string;
  title: string;
  version: number;
  locale: string;
  updatedAt: string;
}

export function summarize(artifact: Artifact): ArtifactSummary {
  return {
    id: artifact.id,
    format: artifact.format,
    title: artifact.title,
    version: artifact.version,
    locale: artifact.locale,
    updatedAt: artifact.meta.updatedAt,
  };
}
