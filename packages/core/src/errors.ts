import type { z } from 'zod';
import { t } from './i18n.js';

/** Error catalog (spec §10.3). `INTERNAL_ERROR` is the only extension: unexpected failures never leak details. */
export const ERROR_CODES = [
  'UNKNOWN_KIND',
  'DUPLICATE_KIND',
  'NOT_FOUND',
  'INVALID_ENVELOPE',
  'UNSUPPORTED_VERSION',
  'MIGRATION_FAILED',
  'INVALID_CONTENT',
  'INVALID_OPERATION',
  'OPERATION_FAILED',
  'VERSION_CONFLICT',
  'LOCKED',
  'LIMIT_EXCEEDED',
  'PERMISSION_DENIED',
  'APPROVAL_REQUIRED',
  'ASSET_REJECTED',
  'EXPORT_FAILED',
  'INTERNAL_ERROR',
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

export interface ErrorIssue {
  /** Exact path, e.g. `operations[2].block.rows[1]`. */
  path: string;
  message: string;
  /** Natural-language fix the model can follow. */
  hint?: string;
}

export interface ModelErrorPayload {
  ok: false;
  error: {
    code: ErrorCode;
    message: string;
    issues?: ErrorIssue[];
    /** Structured, non-sensitive extras (limit and value, current version, diff since base). */
    details?: Record<string, unknown>;
  };
}

export interface ArtifactErrorOptions {
  issues?: ErrorIssue[];
  details?: Record<string, unknown>;
  cause?: unknown;
}

/**
 * The single error type thrown by artkit. `message`, `issues` and `details` are safe to show to a model;
 * the original failure stays in `cause` for logs and diagnostics only.
 */
export class ArtifactError extends Error {
  readonly code: ErrorCode;
  readonly issues: ErrorIssue[];
  readonly details: Record<string, unknown>;

  constructor(code: ErrorCode, message: string, options: ArtifactErrorOptions = {}) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = 'ArtifactError';
    this.code = code;
    this.issues = options.issues ?? [];
    this.details = options.details ?? {};
  }

  toPayload(): ModelErrorPayload {
    return {
      ok: false,
      error: {
        code: this.code,
        message: this.message,
        ...(this.issues.length > 0 ? { issues: this.issues } : {}),
        ...(Object.keys(this.details).length > 0 ? { details: this.details } : {}),
      },
    };
  }
}

export function isArtifactError(value: unknown): value is ArtifactError {
  return value instanceof ArtifactError;
}

/** Converts anything thrown into a payload that never contains stack traces, server paths or foreign data. */
export function toModelError(error: unknown, locale?: string): ModelErrorPayload {
  if (isArtifactError(error)) return error.toPayload();
  return { ok: false, error: { code: 'INTERNAL_ERROR', message: t(locale, 'INTERNAL_ERROR') } };
}

/** Formats a path array as `a.b[2].c`, optionally prefixed. */
export function formatPath(path: ReadonlyArray<PropertyKey>, prefix = ''): string {
  let out = prefix;
  for (const segment of path) {
    if (typeof segment === 'number') out += `[${segment}]`;
    else out += out.length === 0 ? String(segment) : `.${String(segment)}`;
  }
  return out;
}

function describeExpected(expected: unknown): string {
  return String(expected ?? 'value');
}

/** Maps zod issues to model-friendly issues with hints (spec §3: errors written for the model to fix). */
export function zodIssuesToErrorIssues(
  issues: ReadonlyArray<z.core.$ZodIssue>,
  locale: string | undefined,
  prefix = '',
): ErrorIssue[] {
  const out: ErrorIssue[] = [];
  for (const issue of issues) {
    const path = formatPath(issue.path, prefix);
    switch (issue.code) {
      case 'invalid_type': {
        const expected = describeExpected(issue.expected);
        out.push({
          path,
          message: t(locale, 'ZOD_INVALID_TYPE', { expected }),
          hint: t(locale, 'ZOD_INVALID_TYPE_HINT', { expected }),
        });
        break;
      }
      case 'unrecognized_keys':
        out.push({
          path,
          message: t(locale, 'ZOD_UNRECOGNIZED_KEYS', { keys: issue.keys.join(', ') }),
          hint: t(locale, 'ZOD_UNRECOGNIZED_KEYS_HINT'),
        });
        break;
      case 'invalid_value':
        out.push({
          path,
          message: t(locale, 'ZOD_INVALID_VALUE'),
          hint: t(locale, 'ZOD_INVALID_VALUE_HINT', {
            values: issue.values.map((v) => JSON.stringify(v)).join(', '),
          }),
        });
        break;
      case 'too_big':
        out.push({
          path,
          message: t(locale, 'ZOD_TOO_BIG', { maximum: String(issue.maximum) }),
          hint: t(locale, 'ZOD_TOO_BIG_HINT', { maximum: String(issue.maximum) }),
        });
        break;
      case 'too_small':
        out.push({
          path,
          message: t(locale, 'ZOD_TOO_SMALL', { minimum: String(issue.minimum) }),
          hint: t(locale, 'ZOD_TOO_SMALL_HINT', { minimum: String(issue.minimum) }),
        });
        break;
      case 'invalid_format':
        out.push({
          path,
          message: t(locale, 'ZOD_INVALID_FORMAT', { detail: issue.message }),
          hint: t(locale, 'ZOD_INVALID_FORMAT_HINT'),
        });
        break;
      case 'invalid_union': {
        const disc = (issue as { note?: string; discriminator?: string }).discriminator;
        const options = (issue as { options?: unknown[] }).options;
        out.push({
          path,
          message: t(locale, 'ZOD_INVALID_UNION'),
          hint: t(locale, 'ZOD_INVALID_UNION_HINT', {
            discriminator: disc ?? 'op',
            options:
              Array.isArray(options) && options.length > 0
                ? options.map((o) => JSON.stringify(o)).join(', ')
                : '',
          }),
        });
        break;
      }
      default:
        out.push({ path, message: t(locale, 'ZOD_CUSTOM', { message: issue.message }) });
    }
  }
  return out;
}
