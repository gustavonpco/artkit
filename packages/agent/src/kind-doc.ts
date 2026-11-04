import { type AnyArtifactKind, type ArtifactRegistry, operationNames } from '@artkit/core';
import {
  describeContent,
  describeEnvelopeOperations,
  describeOperations,
  type OperationDoc,
} from './schema-doc.js';

/** Registry facts about one kind, shared by instructions and skill references. */
export interface KindFacts {
  kind: AnyArtifactKind;
  operations: string[];
  inputs: { format: string; description: string }[];
  limits: Record<string, number>;
}

export function kindFacts(registry: ArtifactRegistry, kind: AnyArtifactKind): KindFacts {
  return {
    kind,
    operations: operationNames(kind.operationSchema),
    inputs: Object.entries(kind.inputs ?? {}).map(([format, input]) => ({
      format,
      description: input.description,
    })),
    limits: registry.limits(kind.kind),
  };
}

export function operationDocs(kind: AnyArtifactKind): OperationDoc[] {
  return describeOperations(kind.operationSchema);
}

export function envelopeDocs(): OperationDoc[] {
  return describeEnvelopeOperations();
}

export function contentFields(kind: AnyArtifactKind, maxDepth?: number): string[] {
  return describeContent(kind.contentSchema, maxDepth === undefined ? {} : { maxDepth });
}

export function json(value: unknown, pretty = true): string {
  return pretty ? JSON.stringify(value, null, 2) : JSON.stringify(value);
}

/** Selects registered kinds, keeping registry order. Unknown names are ignored. */
export function selectKinds(registry: ArtifactRegistry, names?: readonly string[]): AnyArtifactKind[] {
  const all = registry.kinds();
  if (!names) return all;
  return all.filter((kind) => names.includes(kind.kind));
}

export function applyToolName(kind: string): string {
  return `artifact_apply_${kind.replace(/-/g, '_')}`;
}
