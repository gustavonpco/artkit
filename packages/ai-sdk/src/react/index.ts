import type { UIMessage } from 'ai';
import { useMemo } from 'react';
import { type DeriveArtifactsOptions, type DerivedArtifacts, deriveArtifacts } from '../derive.js';

export type {
  ArtifactPreview,
  ArtifactState,
  DeriveArtifactsOptions,
  DerivedArtifacts,
  PreviewRegistry,
} from '../derive.js';

export type UseArtifactsOptions = DeriveArtifactsOptions;

/**
 * Artifact map derived from `useChat` messages (spec §14.4): last committed version per artifact and streaming
 * previews of `artifact_create`/`artifact_apply` calls. Saving is not part of the chat: the application decides when
 * to save, through the editor's save action.
 */
export function useArtifacts(
  messages: readonly Pick<UIMessage, 'parts'>[],
  options: UseArtifactsOptions = {},
): DerivedArtifacts {
  const { registry, toolPrefix } = options;
  return useMemo(
    () =>
      deriveArtifacts(messages, { ...(registry ? { registry } : {}), ...(toolPrefix ? { toolPrefix } : {}) }),
    [messages, registry, toolPrefix],
  );
}
