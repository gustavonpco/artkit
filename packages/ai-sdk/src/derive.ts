import type { ArtifactStatus } from '@artkit/core';
import type { UIMessage } from 'ai';
import { ARTIFACT_DATA_PART_TYPE, type ArtifactDataPart } from './data-parts.js';

export type ApprovalState = 'approval-requested' | 'approved' | 'rejected';

export interface ArtifactApproval {
  /** Id to answer with `addToolApprovalResponse({ id, approved })`. */
  approvalId: string;
  toolCallId: string;
  toolName: string;
  state: ApprovalState;
  input: unknown;
  /** Reason given by the approval policy when it asked. */
  requestReason?: string;
  /** Reason given by the human with the decision. */
  reason?: string;
  /** Decided by a policy rather than a person. */
  isAutomatic?: boolean;
}

/** Provisional state while a create/apply tool call is streaming or waiting for approval (spec §13.4). */
export interface ArtifactPreview {
  toolCallId: string;
  toolName: string;
  state: string;
  kind?: string;
  title?: string;
  /** Partial content of `artifact_create`, passed through the kind's `parsePartial` when a registry is given. */
  content?: unknown;
  /** Raw `input` of `artifact_create` (e.g. Markdown being streamed). */
  source?: { format?: string; source?: unknown };
  /** Complete operations of `artifact_apply` received so far (the trailing, possibly incomplete one is dropped). */
  operations?: unknown[];
  baseVersion?: number;
}

export interface ArtifactState {
  /** Artifact id, or `call:<toolCallId>` while an `artifact_create` has no id yet. */
  key: string;
  id?: string;
  kind?: string;
  title?: string;
  version?: number;
  status?: ArtifactStatus;
  /** Last committed reference (data part or successful tool output). */
  committed?: ArtifactDataPart;
  preview?: ArtifactPreview;
  approval?: ArtifactApproval;
  /** Last tool error for this artifact, as returned to the model. */
  error?: { code: string; message: string; toolCallId: string };
}

export interface DerivedArtifacts {
  artifacts: ArtifactState[];
  byId: Record<string, ArtifactState>;
  /** Approvals waiting for a human decision. */
  pendingApprovals: ArtifactApproval[];
}

/** The subset of a kind needed for previews; an `ArtifactRegistry` satisfies it. */
export interface PreviewRegistry {
  has(kind: string): boolean;
  get(kind: string): { parsePartial(raw: unknown): unknown };
}

export interface DeriveArtifactsOptions {
  registry?: PreviewRegistry;
  /** Tool name prefix of the artifact tools (default `artifact_`). */
  toolPrefix?: string;
}

type Loose = Record<string, unknown>;

const PREVIEW_STATES = new Set([
  'input-streaming',
  'input-available',
  'approval-requested',
  'approval-responded',
]);
const STATUSES = new Set(['draft', 'pending_approval', 'published', 'archived']);

function isObject(value: unknown): value is Loose {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function asReference(value: unknown): ArtifactDataPart | undefined {
  if (!isObject(value)) return undefined;
  const { id, kind, title, version, status } = value;
  if (typeof id !== 'string' || typeof kind !== 'string' || typeof title !== 'string') return undefined;
  if (typeof version !== 'number' || typeof status !== 'string' || !STATUSES.has(status)) return undefined;
  return { id, kind, title, version, status: status as ArtifactStatus };
}

function toolName(part: Loose): string | undefined {
  if (part.type === 'dynamic-tool') return typeof part.toolName === 'string' ? part.toolName : undefined;
  return typeof part.type === 'string' && part.type.startsWith('tool-') ? part.type.slice(5) : undefined;
}

function approvalOf(part: Loose, name: string): ArtifactApproval | undefined {
  const approval = part.approval;
  if (!isObject(approval) || typeof approval.id !== 'string') return undefined;
  let state: ApprovalState;
  if (part.state === 'approval-requested') state = 'approval-requested';
  else if (part.state === 'output-denied') state = 'rejected';
  else if (typeof approval.approved === 'boolean') state = approval.approved ? 'approved' : 'rejected';
  else return undefined;
  return {
    approvalId: approval.id,
    toolCallId: String(part.toolCallId),
    toolName: name,
    state,
    input: part.input,
    ...(typeof approval.requestReason === 'string' ? { requestReason: approval.requestReason } : {}),
    ...(typeof approval.reason === 'string' ? { reason: approval.reason } : {}),
    ...(typeof approval.isAutomatic === 'boolean' ? { isAutomatic: approval.isAutomatic } : {}),
  };
}

function completeOperations(operations: unknown, streaming: boolean): unknown[] | undefined {
  if (!Array.isArray(operations)) return undefined;
  // While streaming, the last element may be cut mid-object; keep only operations that can be complete.
  const complete = streaming ? operations.slice(0, -1) : operations;
  return complete.filter((op) => isObject(op) && typeof op.op === 'string');
}

/**
 * Derives the artifact map from chat messages (`useChat` parts): last committed version, in-progress
 * previews and approval state. Messages carry references only; content is loaded by the React layer.
 */
export function deriveArtifacts(
  messages: readonly Pick<UIMessage, 'parts'>[],
  options: DeriveArtifactsOptions = {},
): DerivedArtifacts {
  const prefix = options.toolPrefix ?? 'artifact_';
  const entries = new Map<string, ArtifactState>();
  const entry = (key: string): ArtifactState => {
    let found = entries.get(key);
    if (!found) {
      found = { key, ...(key.startsWith('call:') ? {} : { id: key }) };
      entries.set(key, found);
    }
    return found;
  };
  const commit = (reference: ArtifactDataPart) => {
    const state = entry(reference.id);
    // Same version with a new status (submit/approve) still replaces: later parts win.
    if (state.committed && state.committed.version > reference.version) return;
    state.committed = reference;
    Object.assign(state, {
      id: reference.id,
      kind: reference.kind,
      title: reference.title,
      version: reference.version,
      status: reference.status,
    });
  };

  for (const message of messages) {
    for (const raw of message.parts as unknown[]) {
      if (!isObject(raw)) continue;
      if (raw.type === ARTIFACT_DATA_PART_TYPE) {
        const reference = asReference(raw.data);
        if (reference) commit(reference);
        continue;
      }
      const name = toolName(raw);
      if (!name?.startsWith(prefix)) continue;
      const toolCallId = String(raw.toolCallId ?? '');
      const input = isObject(raw.input) ? raw.input : {};
      const isCreate = name === `${prefix}create`;
      const targetId = typeof input.id === 'string' ? input.id : undefined;
      const key = isCreate ? `call:${toolCallId}` : targetId;
      const state = String(raw.state ?? '');

      if (state === 'output-available') {
        const output = raw.output;
        const reference = isObject(output) && output.ok === true ? asReference(output) : undefined;
        if (isCreate) entries.delete(`call:${toolCallId}`);
        if (reference) {
          commit(reference);
          const committed = entry(reference.id);
          if (committed.preview?.toolCallId === toolCallId) delete committed.preview;
          if (committed.error?.toolCallId === toolCallId) delete committed.error;
          const approval = approvalOf(raw, name);
          if (approval) committed.approval = approval;
        } else if (isObject(output) && output.ok === false && isObject(output.error) && targetId) {
          const failed = entry(targetId);
          if (failed.preview?.toolCallId === toolCallId) delete failed.preview;
          failed.error = {
            code: String(output.error.code),
            message: String(output.error.message),
            toolCallId,
          };
        }
        continue;
      }
      if (!key) continue;
      if (state === 'output-error' || state === 'output-denied') {
        if (isCreate) {
          entries.delete(key);
          continue;
        }
        const target = entry(key);
        if (target.preview?.toolCallId === toolCallId) delete target.preview;
        const approval = approvalOf(raw, name);
        if (approval) target.approval = approval;
        continue;
      }
      if (!PREVIEW_STATES.has(state)) continue;
      const isApply = name === `${prefix}apply` || name.startsWith(`${prefix}apply_`);
      if (!isCreate && !isApply && state !== 'approval-requested' && state !== 'approval-responded') continue;
      const target = entry(key);
      const preview: ArtifactPreview = { toolCallId, toolName: name, state };
      if (isCreate) {
        const kind = typeof input.kind === 'string' ? input.kind : undefined;
        if (kind) {
          preview.kind = kind;
          target.kind = kind;
        }
        if (typeof input.title === 'string') {
          preview.title = input.title;
          target.title = input.title;
        }
        if (input.content !== undefined) {
          preview.content =
            kind && options.registry?.has(kind)
              ? options.registry.get(kind).parsePartial(input.content)
              : input.content;
        }
        if (isObject(input.input)) {
          preview.source = {
            ...(typeof input.input.format === 'string' ? { format: input.input.format } : {}),
            source: input.input.source,
          };
        }
      } else if (isApply) {
        const operations = completeOperations(input.operations, state === 'input-streaming');
        if (operations) preview.operations = operations;
        if (typeof input.baseVersion === 'number') preview.baseVersion = input.baseVersion;
      }
      if (isCreate || isApply) target.preview = preview;
      const approval = approvalOf(raw, name);
      if (approval) target.approval = approval;
    }
  }

  const artifacts = [...entries.values()];
  const byId: Record<string, ArtifactState> = {};
  for (const state of artifacts) if (state.id) byId[state.id] = state;
  return {
    artifacts,
    byId,
    pendingApprovals: artifacts.flatMap((state) =>
      state.approval?.state === 'approval-requested' ? [state.approval] : [],
    ),
  };
}
