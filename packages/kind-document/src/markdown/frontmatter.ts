/**
 * Tiny YAML-subset reader for Markdown front matter: `key: scalar`, JSON flow values, nested block maps and
 * lists of scalars or maps. It covers what document front matter uses (title, subtitle, fields) without a
 * YAML dependency; anything it cannot read is reported instead of guessed.
 */

export type YamlValue = string | number | boolean | null | YamlValue[] | { [key: string]: YamlValue };

export interface FrontMatter {
  data: Record<string, YamlValue>;
  body: string;
  warnings: string[];
}

const FENCE = /^---[ \t]*\n(?:([\s\S]*?)\n)?---[ \t]*(?:\n|$)/;

/** Splits leading front matter from the Markdown body. Returns undefined when there is none. */
export function splitFrontMatter(markdown: string): FrontMatter | undefined {
  const match = FENCE.exec(markdown);
  if (!match) return undefined;
  const warnings: string[] = [];
  const lines = (match[1] ?? '').split('\n');
  const parser = new Reader(lines, warnings);
  const data = parser.block(0);
  const value = data !== null && typeof data === 'object' && !Array.isArray(data) ? data : {};
  if (data !== null && (typeof data !== 'object' || Array.isArray(data)))
    warnings.push('Front matter must be a key/value map; it was ignored.');
  return { data: value, body: markdown.slice(match[0].length), warnings };
}

interface Line {
  indent: number;
  text: string;
}

class Reader {
  readonly #lines: Line[];
  #index = 0;

  constructor(
    raw: string[],
    readonly warnings: string[],
  ) {
    this.#lines = raw
      .map((line) => stripComment(line).replace(/\s+$/, ''))
      .filter((line) => line.trim() !== '' && !line.trimStart().startsWith('#'))
      .map((line) => ({ indent: line.length - line.trimStart().length, text: line.trim() }));
  }

  /** Reads a map or list whose lines are indented at least `minIndent`. */
  block(minIndent: number): YamlValue {
    const first = this.#lines[this.#index];
    if (!first || first.indent < minIndent) return null;
    return first.text.startsWith('- ') || first.text === '-'
      ? this.list(first.indent)
      : this.map(first.indent);
  }

  map(indent: number): Record<string, YamlValue> {
    const out: Record<string, YamlValue> = {};
    for (;;) {
      const line = this.#lines[this.#index];
      if (!line || line.indent < indent) return out;
      if (line.indent > indent) {
        this.warnings.push(`Unexpected indentation in front matter: "${line.text}".`);
        this.#index++;
        continue;
      }
      const entry = /^("(?:[^"\\]|\\.)*"|'(?:[^']|'')*'|[^:]+?)\s*:(?:\s+(.*))?$/.exec(line.text);
      if (!entry) {
        this.warnings.push(`Unreadable front matter line: "${line.text}".`);
        this.#index++;
        continue;
      }
      const key = String(scalar(entry[1]!));
      this.#index++;
      const rest = entry[2];
      out[key] = rest === undefined || rest === '' ? this.block(indent + 1) : scalar(rest);
    }
  }

  list(indent: number): YamlValue[] {
    const out: YamlValue[] = [];
    for (;;) {
      const line = this.#lines[this.#index];
      if (!line || line.indent < indent || !(line.text.startsWith('- ') || line.text === '-')) return out;
      if (line.indent > indent) return out;
      const rest = line.text.slice(1).trimStart();
      if (rest === '') {
        this.#index++;
        out.push(this.block(indent + 1));
        continue;
      }
      if (/^("(?:[^"\\]|\\.)*"|'(?:[^']|'')*'|[^:"'{[]+?)\s*:(\s|$)/.test(rest)) {
        // "- key: value" opens a map whose further keys are indented to the column after "- ".
        const column = indent + (line.text.length - rest.length);
        this.#lines[this.#index] = { indent: column, text: rest };
        out.push(this.map(column));
        continue;
      }
      this.#index++;
      out.push(scalar(rest));
    }
  }
}

/** Removes a trailing `# comment` that is outside quotes. */
function stripComment(line: string): string {
  let quote: string | undefined;
  for (let i = 0; i < line.length; i++) {
    const char = line[i]!;
    if (quote) {
      if (char === '\\' && quote === '"') i++;
      else if (char === quote) quote = undefined;
    } else if (char === '"' || char === "'") quote = char;
    else if (char === '#' && (i === 0 || /\s/.test(line[i - 1]!))) return line.slice(0, i);
  }
  return line;
}

function scalar(raw: string): YamlValue {
  const text = raw.trim();
  if (text.startsWith('"')) {
    try {
      return JSON.parse(text) as string;
    } catch {
      return text.slice(1, -1);
    }
  }
  if (text.startsWith("'") && text.endsWith("'") && text.length >= 2)
    return text.slice(1, -1).replace(/''/g, "'");
  if (text.startsWith('{') || text.startsWith('[')) {
    try {
      return JSON.parse(text) as YamlValue;
    } catch {
      return text;
    }
  }
  if (text === 'true' || text === 'false') return text === 'true';
  if (text === 'null' || text === '~') return null;
  if (/^-?\d+(\.\d+)?$/.test(text)) return Number(text);
  return text;
}

/** Serializes a string as a YAML double-quoted scalar (JSON strings are valid YAML). */
export function yamlString(value: string): string {
  return JSON.stringify(value);
}
