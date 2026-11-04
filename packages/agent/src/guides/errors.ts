import type { ErrorCode } from '@artkit/core';

/** Corrective action the model is expected to take for each catalog code (spec §10.3, §14.7). */
export const ERROR_ACTIONS: Record<ErrorCode, string> = {
  UNKNOWN_KIND: 'Pick one of the kinds listed in the hint; do not invent kinds.',
  DUPLICATE_KIND: 'Configuration problem in the application; tell the user, do not retry.',
  NOT_FOUND: 'Check the id with `artifact_list` or read the artifact again; never guess ids.',
  INVALID_ENVELOPE: 'Stored data is corrupt; tell the user, do not retry.',
  UNSUPPORTED_VERSION: 'The artifact was written by a newer version of the application; tell the user.',
  MIGRATION_FAILED: 'The artifact cannot be upgraded automatically; tell the user.',
  INVALID_CONTENT:
    'Fix the fields at the reported `path` following each `hint`, then call again with the whole corrected input.',
  INVALID_OPERATION:
    'Fix the operation at `operations[i]` following the hint (wrong `op`, missing or extra fields); resend the whole batch.',
  OPERATION_FAILED:
    'The operation is valid but does not fit the current state (missing id, bad anchor). Read the outline, use existing ids and resend.',
  VERSION_CONFLICT:
    'Someone else changed the same items. Read the artifact again and redo the operations from the current `version`.',
  LOCKED: 'Another author holds the lock. Wait or ask the user; do not loop retrying.',
  LIMIT_EXCEEDED:
    'Reduce the batch (max operations per call) or the content; split large content into several artifacts or batches.',
  PERMISSION_DENIED: 'You are not allowed to do this. Tell the user; do not retry with other ids.',
  APPROVAL_REQUIRED: 'The action needs human approval. Use `artifact_submit` and wait for the user.',
  ASSET_REJECTED: 'The file type, size or origin is not allowed; use another asset or ask the user.',
  EXPORT_FAILED: 'Try another format once; if it fails again, tell the user.',
  INTERNAL_ERROR: 'Unexpected failure. Retry once; if it repeats, tell the user.',
};

/** Retries before asking the user for help, stated in instructions and SKILL.md. */
export const MAX_RETRIES = 2;
