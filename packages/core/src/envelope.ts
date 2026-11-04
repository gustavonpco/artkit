import { z } from 'zod';
import { artifactIdSchema } from './ids.js';

export const ARTIFACT_STATUSES = ['draft', 'pending_approval', 'published', 'archived'] as const;
export type ArtifactStatus = (typeof ARTIFACT_STATUSES)[number];
export const artifactStatusSchema = z.enum(ARTIFACT_STATUSES);

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
  /** Last approved version, kept as the reference while a newer draft waits for approval (spec §15.3). */
  publishedVersion: z.number().int().min(1).optional(),
});
export type ArtifactMeta = z.infer<typeof metaSchema>;

/** Envelope (spec §6.1). Only `content` is produced by the model; everything else is system-owned. */
export const envelopeSchema = z.object({
  id: artifactIdSchema,
  kind: z.string().min(1).max(64),
  schemaVersion: z.number().int().min(1),
  version: z.number().int().min(1),
  title: titleSchema,
  status: artifactStatusSchema,
  locale: localeSchema,
  themeId: z.string().min(1).max(64),
  content: z.unknown(),
  meta: metaSchema,
});

export interface Artifact<Content = unknown> {
  id: string;
  kind: string;
  schemaVersion: number;
  version: number;
  title: string;
  status: ArtifactStatus;
  locale: string;
  themeId: string;
  content: Content;
  meta: ArtifactMeta;
}

/** Lightweight reference carried in chat messages and lists (no content). */
export interface ArtifactSummary {
  id: string;
  kind: string;
  title: string;
  version: number;
  status: ArtifactStatus;
  locale: string;
  updatedAt: string;
}

export function summarize(artifact: Artifact): ArtifactSummary {
  return {
    id: artifact.id,
    kind: artifact.kind,
    title: artifact.title,
    version: artifact.version,
    status: artifact.status,
    locale: artifact.locale,
    updatedAt: artifact.meta.updatedAt,
  };
}

/** Allowed lifecycle transitions (spec §15.3). */
export const STATUS_TRANSITIONS: Record<ArtifactStatus, readonly ArtifactStatus[]> = {
  draft: ['pending_approval', 'published', 'archived'],
  pending_approval: ['published', 'draft', 'archived'],
  published: ['archived', 'draft'],
  archived: ['draft'],
};

export function canTransition(from: ArtifactStatus, to: ArtifactStatus): boolean {
  return STATUS_TRANSITIONS[from].includes(to);
}
