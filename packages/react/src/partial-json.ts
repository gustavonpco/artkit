const INCOMPLETE = Symbol('incomplete');
const MAX_DEPTH = 200;

class PartialJsonSyntaxError extends Error {}

/**
 * Best-effort parse of a JSON prefix streamed by a model (spec §13.4). Complete values are kept, a string
 * value cut midway keeps the text received so far, and anything else unfinished at the end (a key, a
 * number, a literal) is dropped. Returns undefined for text that is not a JSON prefix. The kind's
 * `parsePartial` then decides which trailing items are complete enough to render.
 */
export function parsePartialJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    // Not complete yet: fall through to the tolerant parser.
  }
  let i = 0;
  const length = text.length;

  const skipWhitespace = () => {
    while (i < length && (text[i] === ' ' || text[i] === '\n' || text[i] === '\r' || text[i] === '\t')) i++;
  };

  function parseString(): { value: string; complete: boolean } {
    i++; // opening quote
    let out = '';
    while (i < length) {
      const char = text[i]!;
      if (char === '"') {
        i++;
        return { value: out, complete: true };
      }
      if (char === '\\') {
        const next = text[i + 1];
        if (next === undefined) break;
        if (next === 'u') {
          const hex = text.slice(i + 2, i + 6);
          if (hex.length < 4) break;
          if (!/^[0-9a-fA-F]{4}$/.test(hex)) throw new PartialJsonSyntaxError('bad escape');
          out += String.fromCharCode(Number.parseInt(hex, 16));
          i += 6;
          continue;
        }
        const escapes: Record<string, string> = {
          '"': '"',
          '\\': '\\',
          '/': '/',
          b: '\b',
          f: '\f',
          n: '\n',
          r: '\r',
          t: '\t',
        };
        const mapped = escapes[next];
        if (mapped === undefined) throw new PartialJsonSyntaxError('bad escape');
        out += mapped;
        i += 2;
        continue;
      }
      out += char;
      i++;
    }
    i = length;
    return { value: out, complete: false };
  }

  function parseValue(depth: number): unknown {
    if (depth > MAX_DEPTH) throw new PartialJsonSyntaxError('too deep');
    skipWhitespace();
    if (i >= length) return INCOMPLETE;
    const char = text[i]!;
    if (char === '{') return parseObject(depth);
    if (char === '[') return parseArray(depth);
    if (char === '"') return parseString().value;
    for (const [literal, value] of [
      ['true', true],
      ['false', false],
      ['null', null],
    ] as const) {
      if (text.startsWith(literal, i)) {
        i += literal.length;
        return value;
      }
      if (literal.startsWith(text.slice(i))) {
        i = length;
        return INCOMPLETE;
      }
    }
    const rest = text.slice(i);
    const numeric = /^[-+0-9.eE]*/.exec(rest)?.[0] ?? '';
    if (numeric.length === 0) throw new PartialJsonSyntaxError('unexpected token');
    // A number touching the end of the stream may still grow ("12" → "123", "1." → "1.5").
    if (numeric.length === rest.length) {
      i = length;
      return INCOMPLETE;
    }
    if (!/^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/.test(numeric))
      throw new PartialJsonSyntaxError('bad number');
    i += numeric.length;
    return Number(numeric);
  }

  function parseObject(depth: number): Record<string, unknown> {
    i++;
    const result: Record<string, unknown> = {};
    for (;;) {
      skipWhitespace();
      if (i >= length) return result;
      const char = text[i]!;
      if (char === '}') {
        i++;
        return result;
      }
      if (char === ',') {
        i++;
        continue;
      }
      if (char !== '"') throw new PartialJsonSyntaxError('expected key');
      const key = parseString();
      if (!key.complete) return result;
      skipWhitespace();
      if (i >= length) return result;
      if (text[i] !== ':') throw new PartialJsonSyntaxError('expected colon');
      i++;
      const value = parseValue(depth + 1);
      if (value === INCOMPLETE) return result;
      result[key.value] = value;
    }
  }

  function parseArray(depth: number): unknown[] {
    i++;
    const result: unknown[] = [];
    for (;;) {
      skipWhitespace();
      if (i >= length) return result;
      const char = text[i]!;
      if (char === ']') {
        i++;
        return result;
      }
      if (char === ',') {
        i++;
        continue;
      }
      const value = parseValue(depth + 1);
      if (value === INCOMPLETE) return result;
      result.push(value);
    }
  }

  try {
    const value = parseValue(0);
    return value === INCOMPLETE ? undefined : value;
  } catch (error) {
    if (error instanceof PartialJsonSyntaxError) return undefined;
    throw error;
  }
}
