import { z } from 'zod';

// Control characters except tab (\u0009), line feed (\u000A) and carriage return (\u000D).
// biome-ignore lint/suspicious/noControlCharactersInRegex: stripping control characters is the point.
const CONTROL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/g;

/** Removes control characters and normalizes to Unicode NFC (spec §10.1). */
export function sanitizeString(value: string): string {
  return value.replace(CONTROL_CHARS, '').normalize('NFC');
}

/**
 * Deeply sanitizes every string in a JSON-like value. Applied to all model and user input before validation,
 * so schemas can stay free of transforms (which keeps JSON Schema generation exact).
 */
export function sanitizeDeep<T>(value: T, depth = 0): T {
  if (depth > 64) return value;
  if (typeof value === 'string') return sanitizeString(value) as T;
  if (Array.isArray(value)) return value.map((item) => sanitizeDeep(item, depth + 1)) as T;
  if (value !== null && typeof value === 'object') {
    const proto = Object.getPrototypeOf(value);
    if (proto !== Object.prototype && proto !== null) return value;
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) {
      if (key === '__proto__' || key === 'constructor' || key === 'prototype') continue;
      out[sanitizeString(key)] = sanitizeDeep(item, depth + 1);
    }
    return out as T;
  }
  return value;
}

const ALLOWED_LINK = /^(https?:\/\/[^\s]+|mailto:[^\s]+|#[A-Za-z0-9][A-Za-z0-9_-]{0,63})$/i;

/** Returns true for http(s), mailto and internal anchors (`#id`). */
export function isSafeLink(href: string): boolean {
  return ALLOWED_LINK.test(href.trim());
}

export const linkSchema = z
  .string()
  .max(2048)
  .refine(isSafeLink, { message: 'Links must use https, http, mailto or an internal anchor (#id).' })
  .describe('Link target: https/http URL, mailto: address or internal anchor "#id".');

/** Maximum JSON nesting depth accepted from external input. */
export const MAX_INPUT_DEPTH = 32;

export function jsonDepth(value: unknown, depth = 0): number {
  if (depth > MAX_INPUT_DEPTH + 1) return depth;
  if (Array.isArray(value)) {
    let max = depth;
    for (const item of value) max = Math.max(max, jsonDepth(item, depth + 1));
    return max;
  }
  if (value !== null && typeof value === 'object') {
    let max = depth;
    for (const item of Object.values(value)) max = Math.max(max, jsonDepth(item, depth + 1));
    return max;
  }
  return depth;
}

/** Byte size of the UTF-8 JSON serialization. */
export function jsonByteSize(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value) ?? '').byteLength;
}
