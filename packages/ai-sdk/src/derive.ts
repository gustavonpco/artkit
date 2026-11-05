import type { UIMessage } from 'ai';
import { ARTIFACT_DATA_PART_TYPE, type ArtifactDataPart } from './data-parts.js';

/** Provisional state while a create/apply tool call is streaming (spec §13.4). */
export interface ArtifactPreview {
  toolCallId: string;
  toolName: string;
  state: string;
  format?: string;
  title?: string;
  /** Partial content of `artifact_create`, passed through the format's `parsePartial` when a registry is given. */
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
  format?: string;
  title?: string;
  version?: number;
  /** Last committed reference (data part or successful tool output). */
  committed?: ArtifactDataPart;
  preview?: ArtifactPreview;
  /** Last tool error for this artifact, as returned to the model. */
  error?: { code: string; message: string; toolCallId: string };
}

export interface DerivedArtifacts {
  artifacts: ArtifactState[];
  byId: Record<string, ArtifactState>;
}

/** The subset of a registry needed for previews; an `ArtifactRegistry` satisfies it. */
export interface PreviewRegistry {
  has(format: string): boolean;
  get(format: string): { parsePartial(raw: unknown): unknown };
}

export interface DeriveArtifactsOptions {
  registry?: PreviewRegistry;
  /** Tool name prefix of the artifact tools (default `artifact_`). */
  toolPrefix?: string;
}

type Loose = Record<string, unknown>;

const PREVIEW_STATES = new Set(['input-streaming', 'input-available']);

function isObject(value: unknown): value is Loose {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function asReference(value: unknown): ArtifactDataPart | undefined {
  if (!isObject(value)) return undefined;
  const { id, format, title, version } = value;
  if (typeof id !== 'string' || typeof format !== 'string' || typeof title !== 'string') return undefined;
  if (typeof version !== 'number') return undefined;
  return { id, format, title, version };
}

function toolName(part: Loose): string | undefined {
  if (part.type === 'dynamic-tool') return typeof part.toolName === 'string' ? part.toolName : undefined;
  return typeof part.type === 'string' && part.type.startsWith('tool-') ? part.type.slice(5) : undefined;
}

function completeOperations(operations: unknown, streaming: boolean): unknown[] | undefined {
  if (!Array.isArray(operations)) return undefined;
  // While streaming, the last element may be cut mid-object; keep only operations that can be complete.
  const complete = streaming ? operations.slice(0, -1) : operations;
  return complete.filter((op) => isObject(op) && typeof op.op === 'string');
}

/**
 * Derives the artifact map from chat messages (`useChat` parts): last committed version and in-progress previews.
 * Messages carry references only; content is loaded by the React layer.
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
    if (state.committed && state.committed.version > reference.version) return;
    state.committed = reference;
    Object.assign(state, {
      id: reference.id,
      format: reference.format,
      title: reference.title,
      version: reference.version,
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
        continue;
      }
      if (!PREVIEW_STATES.has(state)) continue;
      const isApply = name === `${prefix}apply` || name.startsWith(`${prefix}apply_`);
      if (!isCreate && !isApply) continue;
      const target = entry(key);
      const preview: ArtifactPreview = { toolCallId, toolName: name, state };
      if (isCreate) {
        const format = typeof input.format === 'string' ? input.format : undefined;
        if (format) {
          preview.format = format;
          target.format = format;
        }
        if (typeof input.title === 'string') {
          preview.title = input.title;
          target.title = input.title;
        }
        if (input.content !== undefined) {
          preview.content =
            format && options.registry?.has(format)
              ? options.registry.get(format).parsePartial(input.content)
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
      target.preview = preview;
    }
  }

  const artifacts = [...entries.values()];
  const byId: Record<string, ArtifactState> = {};
  for (const state of artifacts) if (state.id) byId[state.id] = state;
  return { artifacts, byId };
}
