import type { UIMessage } from 'ai';
import { useCallback, useMemo } from 'react';
import { type DeriveArtifactsOptions, type DerivedArtifacts, deriveArtifacts } from '../derive.js';

export type {
  ApprovalState,
  ArtifactApproval,
  ArtifactPreview,
  ArtifactState,
  DeriveArtifactsOptions,
  DerivedArtifacts,
  PreviewRegistry,
} from '../derive.js';

/** Shape of `useChat().addToolApprovalResponse` in AI SDK 7. */
export type AddToolApprovalResponse = (response: {
  id: string;
  approved: boolean;
  reason?: string;
}) => void | PromiseLike<void>;

export interface UseArtifactsOptions extends DeriveArtifactsOptions {
  /** Pass `addToolApprovalResponse` from `useChat` to enable `approve` and `reject`. */
  addToolApprovalResponse?: AddToolApprovalResponse;
}

export interface UseArtifactsResult extends DerivedArtifacts {
  approve(approvalId: string, reason?: string): Promise<void>;
  reject(approvalId: string, reason?: string): Promise<void>;
}

/**
 * Artifact map derived from `useChat` messages (spec §14.4): last committed version per artifact, streaming
 * previews of `artifact_create`/`artifact_apply` calls and approval state, with actions bound to the AI SDK
 * tool approval protocol. Pair with `sendAutomaticallyWhen: lastAssistantMessageIsCompleteWithApprovalResponses`
 * so the run resumes after a decision.
 */
export function useArtifacts(
  messages: readonly Pick<UIMessage, 'parts'>[],
  options: UseArtifactsOptions = {},
): UseArtifactsResult {
  const { registry, toolPrefix, addToolApprovalResponse } = options;
  const derived = useMemo(
    () =>
      deriveArtifacts(messages, { ...(registry ? { registry } : {}), ...(toolPrefix ? { toolPrefix } : {}) }),
    [messages, registry, toolPrefix],
  );
  const respond = useCallback(
    async (approvalId: string, approved: boolean, reason?: string) => {
      if (!addToolApprovalResponse) {
        throw new Error('useArtifacts: pass addToolApprovalResponse from useChat to answer approvals.');
      }
      await addToolApprovalResponse({ id: approvalId, approved, ...(reason ? { reason } : {}) });
    },
    [addToolApprovalResponse],
  );
  const approve = useCallback(
    (approvalId: string, reason?: string) => respond(approvalId, true, reason),
    [respond],
  );
  const reject = useCallback(
    (approvalId: string, reason?: string) => respond(approvalId, false, reason),
    [respond],
  );
  return useMemo(() => ({ ...derived, approve, reject }), [derived, approve, reject]);
}
