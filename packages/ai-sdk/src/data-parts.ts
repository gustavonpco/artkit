import type { ArtifactReference } from '@artkit-ai/agent';
import type { UIMessage } from 'ai';

/** Name of the data part type (`data-artifact` in the UI stream). */
export const ARTIFACT_DATA_PART = 'artifact';
export const ARTIFACT_DATA_PART_TYPE = `data-${ARTIFACT_DATA_PART}` as const;

/** Payload of a `data-artifact` part: a reference only, never the content (spec §14.4). */
export type ArtifactDataPart = ArtifactReference;

/** UI data types to use in `UIMessage<…, ArtifactUIDataTypes>` so `data-artifact` parts are typed. */
export type ArtifactUIDataTypes = { [ARTIFACT_DATA_PART]: ArtifactDataPart };

export type ArtifactUIMessage<METADATA = unknown> = UIMessage<METADATA, ArtifactUIDataTypes>;

/**
 * Minimal writer surface (satisfied by the AI SDK `UIMessageStreamWriter`), so the context schema does not
 * depend on the message generics of the host application.
 */
export interface ArtifactPartWriter {
  write(part: { type: typeof ARTIFACT_DATA_PART_TYPE; id: string; data: ArtifactDataPart }): void;
}

/**
 * Writes (or updates in place) the `data-artifact` part of an artifact. The part id is the artifact id, so the
 * client keeps one part per artifact and replaces it on each commit.
 */
export function writeArtifactDataPart(writer: ArtifactPartWriter, artifact: ArtifactReference): void {
  writer.write({
    type: ARTIFACT_DATA_PART_TYPE,
    id: artifact.id,
    data: {
      id: artifact.id,
      format: artifact.format,
      title: artifact.title,
      version: artifact.version,
    },
  });
}
