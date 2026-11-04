import type { CheckResult } from './types.js';

/** Collects named assertions and turns them into a CheckResult. */
export class Assertions {
  readonly #failures: string[] = [];
  #total = 0;

  that(condition: unknown, description: string): boolean {
    this.#total += 1;
    if (!condition) this.#failures.push(description);
    return Boolean(condition);
  }

  result(): CheckResult {
    const passed = this.#failures.length === 0 && this.#total > 0;
    return {
      passed,
      score: this.#total === 0 ? 0 : (this.#total - this.#failures.length) / this.#total,
      failures: [...this.#failures],
    };
  }
}

interface Run {
  text?: string;
}

/** Plain text of a run list (document blocks, table cells). */
export function runsText(runs: unknown): string {
  if (typeof runs === 'string') return runs;
  if (!Array.isArray(runs)) return '';
  return runs.map((run) => (typeof run === 'string' ? run : ((run as Run)?.text ?? ''))).join('');
}

/** Every string inside a JSON value, joined; used for loose "mentions" checks. */
export function allText(value: unknown): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number') return String(value);
  if (Array.isArray(value)) return value.map(allText).join(' ');
  if (value !== null && typeof value === 'object') return Object.values(value).map(allText).join(' ');
  return '';
}

export function normalize(text: string): string {
  return text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
}

export function near(value: unknown, expected: number, tolerance = 0.01): boolean {
  return typeof value === 'number' && Math.abs(value - expected) <= tolerance;
}

/** Accepts 19800, 19.800, 19,800, 19 800 and their decimal variants. */
export function mentionsNumber(text: string, value: number): boolean {
  const digits = text.replace(/(\d)[.\s ,](?=\d{3}\b)/g, '$1');
  return new RegExp(`(^|\\D)${value}([.,]0+)?(\\D|$)`).test(digits);
}
