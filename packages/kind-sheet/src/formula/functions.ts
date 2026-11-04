import { buildCriteria, hasWildcards, wildcardRegex } from './criteria.js';
import { dayOfWeek, daysInMonth, MAX_SERIAL, partsFromSerial, serialFromParts } from './dates.js';
import { formatWithCode } from './numfmt.js';
import {
  clipToUsed,
  type EvalContext,
  forEachArg,
  forEachCell,
  isRange,
  makeRange,
  type RangeRef,
  rangeArea,
  rangeHeight,
  rangeWidth,
  toScalar,
  type Value,
} from './runtime.js';
import {
  compareScalars,
  ERR,
  FormulaError,
  isError,
  normalizeNumber,
  parseNumericText,
  type Scalar,
  toBoolean,
  toNumber,
  toText,
} from './values.js';

export type FunctionCategory = 'math' | 'logical' | 'lookup' | 'text' | 'date';

export interface FunctionSpec {
  name: string;
  category: FunctionCategory;
  minArgs: number;
  maxArgs: number;
  /** `SUMIF(range, criteria, [sum_range])` */
  signature: string;
  description: string;
  /** `missing` holds the indexes of arguments left empty (`IF(A1,,1)`). */
  call(args: Value[], ctx: EvalContext, missing: ReadonlySet<number>): Value;
}

type Impl = FunctionSpec['call'];

const num = (value: Value, ctx: EvalContext): number | FormulaError => toNumber(toScalar(value, ctx));
const int = (value: Value, ctx: EvalContext): number | FormulaError => {
  const n = num(value, ctx);
  return isError(n) ? n : Math.trunc(n);
};
const text = (value: Value, ctx: EvalContext): string | FormulaError => toText(toScalar(value, ctx));
const optional = (args: Value[], index: number): Value | undefined =>
  index < args.length ? args[index] : undefined;

/** Collects numbers like SUM does: numbers from ranges, coercible scalars from direct arguments. */
function collectNumbers(args: Value[], ctx: EvalContext): number[] | FormulaError {
  const out: number[] = [];
  const failure = forEachArg(args, ctx, (value, fromRange) => {
    if (isError(value)) return value;
    if (fromRange) {
      if (typeof value === 'number') out.push(value);
      return;
    }
    if (value === null) return;
    const n = toNumber(value);
    if (isError(n)) return n;
    out.push(n);
  });
  return failure ?? out;
}

function shiftDigits(value: number, digits: number, mode: 'round' | 'up' | 'down'): number {
  const sign = value < 0 ? -1 : 1;
  const abs = Math.abs(value);
  const fn = mode === 'round' ? Math.round : mode === 'up' ? Math.ceil : Math.floor;
  if (String(abs).includes('e')) {
    const factor = 10 ** digits;
    return (sign * fn(Number((abs * factor).toPrecision(15)))) / factor;
  }
  // Decimal shifting through the exponent notation avoids binary artifacts (1.005 → 1.01).
  const shifted = Number(`${abs}e${digits}`);
  return sign * Number(`${fn(Number(shifted.toPrecision(15)))}e${-digits}`);
}

function rounding(mode: 'round' | 'up' | 'down'): Impl {
  return (args, ctx) => {
    const value = num(args[0]!, ctx);
    if (isError(value)) return value;
    const digits = args.length > 1 ? int(args[1]!, ctx) : 0;
    if (isError(digits)) return digits;
    return normalizeNumber(shiftDigits(value, digits, mode));
  };
}

function requireRange(value: Value): RangeRef | FormulaError {
  return isRange(value) ? value : isError(value) ? value : ERR.VALUE;
}

/** Counts positions of equally sized ranges matching every criterion (COUNTIFS/SUMIFS core). */
function matchPositions(
  pairs: { range: RangeRef; criteria: Scalar }[],
  ctx: EvalContext,
  visit: (dr: number, dc: number) => FormulaError | undefined,
  candidates?: RangeRef,
): FormulaError | undefined {
  const first = pairs[0]!.range;
  const height = rangeHeight(first);
  const width = rangeWidth(first);
  for (const pair of pairs)
    if (rangeHeight(pair.range) !== height || rangeWidth(pair.range) !== width) return ERR.VALUE;
  const matchers = pairs.map((pair) => ({ range: pair.range, test: buildCriteria(pair.criteria) }));
  const matches = (dr: number, dc: number) =>
    matchers.every(({ range, test }) => test(ctx.read(range.sheet, range.top + dr, range.left + dc)));
  const positions = new Set<number>();
  const blankMatches = matchers.every(({ test }) => test(null));
  const source = candidates ?? (blankMatches ? undefined : first);
  if (source) {
    // Only positions where `source` has a cell can match (blank positions fail at least one criterion).
    forEachCell(source, ctx, (_value, row, col) => {
      positions.add((row - source.top) * width + (col - source.left));
    });
    if (!candidates) {
      for (const { range } of matchers.slice(1)) {
        forEachCell(range, ctx, (_value, row, col) => {
          positions.add((row - range.top) * width + (col - range.left));
        });
      }
    }
  } else {
    for (let p = 0; p < height * width; p++) positions.add(p);
  }
  for (const p of [...positions].sort((a, b) => a - b)) {
    const dr = Math.floor(p / width);
    const dc = p - dr * width;
    if (!matches(dr, dc)) continue;
    const failure = visit(dr, dc);
    if (failure) return failure;
  }
  return undefined;
}

function criteriaPairs(
  args: Value[],
  ctx: EvalContext,
  start: number,
): { range: RangeRef; criteria: Scalar }[] | FormulaError {
  const pairs: { range: RangeRef; criteria: Scalar }[] = [];
  for (let i = start; i < args.length; i += 2) {
    const range = requireRange(args[i]!);
    if (isError(range)) return range;
    pairs.push({ range, criteria: toScalar(args[i + 1]!, ctx) });
  }
  return pairs;
}

/** Exact match test used by lookups: same type, case-insensitive text, optional wildcards. */
function exactMatcher(lookup: Scalar, wildcards: boolean): (value: Scalar) => boolean {
  if (typeof lookup === 'string') {
    if (wildcards && hasWildcards(lookup)) {
      const regex = wildcardRegex(lookup);
      return (value) => typeof value === 'string' && regex.test(value);
    }
    const key = lookup.toUpperCase();
    return (value) => typeof value === 'string' && value.toUpperCase() === key;
  }
  return (value) => value !== null && !isError(value) && typeof value === typeof lookup && value === lookup;
}

function sameType(a: Scalar, b: Scalar): boolean {
  return a !== null && b !== null && !isError(a) && !isError(b) && typeof a === typeof b;
}

/** Values of a one-dimensional range clipped to the used area, plus its orientation. */
function vector(range: RangeRef, ctx: EvalContext): { values: Scalar[]; vertical: boolean } | FormulaError {
  const vertical = rangeWidth(range) === 1;
  if (!vertical && rangeHeight(range) !== 1) return ERR.NA;
  const clipped = clipToUsed(range);
  const values: Scalar[] = [];
  if (vertical)
    for (let row = clipped.top; row <= clipped.bottom; row++)
      values.push(ctx.read(range.sheet, row, range.left));
  else
    for (let col = clipped.left; col <= clipped.right; col++)
      values.push(ctx.read(range.sheet, range.top, col));
  return { values, vertical };
}

/** Approximate match: position of the largest value <= lookup (ascending) or smallest >= lookup (descending). */
function approximate(values: Scalar[], lookup: Scalar, descending: boolean): number {
  let found = -1;
  for (let i = 0; i < values.length; i++) {
    const value = values[i]!;
    if (!sameType(value, lookup)) continue;
    const cmp = compareScalars(
      value as Exclude<Scalar, FormulaError>,
      lookup as Exclude<Scalar, FormulaError>,
    );
    if (cmp === 0) return i;
    if (descending ? cmp > 0 : cmp < 0) found = i;
    else break;
  }
  return found;
}

function weekdayNumber(serial: number, type: number): number | FormulaError {
  const dow = dayOfWeek(serial);
  switch (type) {
    case 1:
      return dow + 1;
    case 2:
      return ((dow + 6) % 7) + 1;
    case 3:
      return (dow + 6) % 7;
    default:
      if (type >= 11 && type <= 17) {
        const startDow = (type - 10) % 7;
        return ((dow - startDow + 7) % 7) + 1;
      }
      return ERR.NUM;
  }
}

function addMonths(serial: number, months: number, endOfMonth: boolean): number | FormulaError {
  if (serial < 0) return ERR.NUM;
  const { year, month, day } = partsFromSerial(serial);
  const total = year * 12 + (month - 1) + months;
  const y = Math.floor(total / 12);
  const m = total - y * 12 + 1;
  if (y < 1900 || y > 9999) return ERR.NUM;
  const last = daysInMonth(y, m);
  return serialFromParts(y, m, endOfMonth ? last : Math.min(day, last));
}

const SPECS: Omit<FunctionSpec, 'call'>[] = [];
const IMPLS = new Map<string, Impl>();

function define(spec: Omit<FunctionSpec, 'call'>, call: Impl): void {
  SPECS.push(spec);
  IMPLS.set(spec.name, call);
}

// ---- Math and aggregation ----

define(
  {
    name: 'SUM',
    category: 'math',
    minArgs: 1,
    maxArgs: 255,
    signature: 'SUM(number1, [number2], ...)',
    description: 'Adds numbers and ranges.',
  },
  (args, ctx) => {
    const numbers = collectNumbers(args, ctx);
    return isError(numbers) ? numbers : normalizeNumber(numbers.reduce((a, b) => a + b, 0));
  },
);
define(
  {
    name: 'SUMIF',
    category: 'math',
    minArgs: 2,
    maxArgs: 3,
    signature: 'SUMIF(range, criteria, [sum_range])',
    description:
      'Adds the cells of sum_range whose matching cell in range meets the criteria (">10", "<>x", "a*").',
  },
  (args, ctx) => {
    const range = requireRange(args[0]!);
    if (isError(range)) return range;
    let sumRange = range;
    if (args.length > 2) {
      const given = requireRange(args[2]!);
      if (isError(given)) return given;
      // Like Excel, sum_range takes the shape of range from its top-left cell.
      const resized = makeRange(
        given.sheet,
        given.top,
        given.left,
        given.top + rangeHeight(range) - 1,
        given.left + rangeWidth(range) - 1,
      );
      if (isError(resized)) return resized;
      sumRange = resized;
    }
    let total = 0;
    const failure = matchPositions([{ range, criteria: toScalar(args[1]!, ctx) }], ctx, (dr, dc) => {
      const value = ctx.read(sumRange.sheet, sumRange.top + dr, sumRange.left + dc);
      if (isError(value)) return value;
      if (typeof value === 'number') total += value;
    });
    return failure ?? normalizeNumber(total);
  },
);
define(
  {
    name: 'SUMIFS',
    category: 'math',
    minArgs: 3,
    maxArgs: 255,
    signature: 'SUMIFS(sum_range, criteria_range1, criteria1, [criteria_range2, criteria2], ...)',
    description: 'Adds the cells of sum_range that meet every criterion.',
  },
  (args, ctx) => {
    if (args.length % 2 === 0) return ERR.VALUE;
    const sumRange = requireRange(args[0]!);
    if (isError(sumRange)) return sumRange;
    const pairs = criteriaPairs(args, ctx, 1);
    if (isError(pairs)) return pairs;
    if (
      pairs.some(
        (pair) =>
          rangeHeight(pair.range) !== rangeHeight(sumRange) ||
          rangeWidth(pair.range) !== rangeWidth(sumRange),
      )
    )
      return ERR.VALUE;
    let total = 0;
    const failure = matchPositions(
      pairs,
      ctx,
      (dr, dc) => {
        const value = ctx.read(sumRange.sheet, sumRange.top + dr, sumRange.left + dc);
        if (isError(value)) return value;
        if (typeof value === 'number') total += value;
      },
      sumRange,
    );
    return failure ?? normalizeNumber(total);
  },
);
define(
  {
    name: 'AVERAGE',
    category: 'math',
    minArgs: 1,
    maxArgs: 255,
    signature: 'AVERAGE(number1, [number2], ...)',
    description: 'Arithmetic mean of the numbers.',
  },
  (args, ctx) => {
    const numbers = collectNumbers(args, ctx);
    if (isError(numbers)) return numbers;
    if (numbers.length === 0) return ERR.DIV0;
    return normalizeNumber(numbers.reduce((a, b) => a + b, 0) / numbers.length);
  },
);
define(
  {
    name: 'MIN',
    category: 'math',
    minArgs: 1,
    maxArgs: 255,
    signature: 'MIN(number1, [number2], ...)',
    description: 'Smallest number (0 when there is none).',
  },
  (args, ctx) => {
    const numbers = collectNumbers(args, ctx);
    if (isError(numbers)) return numbers;
    return numbers.reduce((a, b) => Math.min(b, a), numbers[0] ?? 0);
  },
);
define(
  {
    name: 'MAX',
    category: 'math',
    minArgs: 1,
    maxArgs: 255,
    signature: 'MAX(number1, [number2], ...)',
    description: 'Largest number (0 when there is none).',
  },
  (args, ctx) => {
    const numbers = collectNumbers(args, ctx);
    if (isError(numbers)) return numbers;
    return numbers.reduce((a, b) => Math.max(b, a), numbers[0] ?? 0);
  },
);
define(
  {
    name: 'COUNT',
    category: 'math',
    minArgs: 1,
    maxArgs: 255,
    signature: 'COUNT(value1, [value2], ...)',
    description: 'Counts numbers.',
  },
  (args, ctx) => {
    let count = 0;
    forEachArg(args, ctx, (value, fromRange) => {
      if (typeof value === 'number') count++;
      else if (
        !fromRange &&
        (typeof value === 'boolean' || (typeof value === 'string' && parseNumericText(value) !== undefined))
      )
        count++;
    });
    return count;
  },
);
define(
  {
    name: 'COUNTA',
    category: 'math',
    minArgs: 1,
    maxArgs: 255,
    signature: 'COUNTA(value1, [value2], ...)',
    description: 'Counts non-empty values.',
  },
  (args, ctx) => {
    let count = 0;
    forEachArg(args, ctx, (value) => {
      if (value !== null) count++;
    });
    return count;
  },
);
define(
  {
    name: 'COUNTIF',
    category: 'math',
    minArgs: 2,
    maxArgs: 2,
    signature: 'COUNTIF(range, criteria)',
    description: 'Counts cells that meet the criteria (">10", "<>x", "a*", "" for blanks).',
  },
  (args, ctx) => {
    const range = requireRange(args[0]!);
    if (isError(range)) return range;
    const test = buildCriteria(toScalar(args[1]!, ctx));
    let count = 0;
    let filled = 0;
    forEachCell(range, ctx, (value) => {
      if (value !== null) filled++;
      if (test(value)) count++;
    });
    if (test(null)) count += rangeArea(range) - filled;
    return count;
  },
);
define(
  {
    name: 'COUNTIFS',
    category: 'math',
    minArgs: 2,
    maxArgs: 254,
    signature: 'COUNTIFS(criteria_range1, criteria1, [criteria_range2, criteria2], ...)',
    description: 'Counts positions that meet every criterion.',
  },
  (args, ctx) => {
    if (args.length % 2 !== 0) return ERR.VALUE;
    const pairs = criteriaPairs(args, ctx, 0);
    if (isError(pairs)) return pairs;
    let count = 0;
    const failure = matchPositions(pairs, ctx, () => {
      count++;
    });
    return failure ?? count;
  },
);
define(
  {
    name: 'ROUND',
    category: 'math',
    minArgs: 1,
    maxArgs: 2,
    signature: 'ROUND(number, [num_digits])',
    description: 'Rounds half away from zero.',
  },
  rounding('round'),
);
define(
  {
    name: 'ROUNDUP',
    category: 'math',
    minArgs: 1,
    maxArgs: 2,
    signature: 'ROUNDUP(number, [num_digits])',
    description: 'Rounds away from zero.',
  },
  rounding('up'),
);
define(
  {
    name: 'ROUNDDOWN',
    category: 'math',
    minArgs: 1,
    maxArgs: 2,
    signature: 'ROUNDDOWN(number, [num_digits])',
    description: 'Rounds toward zero.',
  },
  rounding('down'),
);

// ---- Logical ----

define(
  {
    name: 'IF',
    category: 'logical',
    minArgs: 2,
    maxArgs: 3,
    signature: 'IF(logical_test, value_if_true, [value_if_false])',
    description: 'Returns one value when the test is TRUE and another when it is FALSE.',
  },
  (args, ctx) => {
    const test = toBoolean(toScalar(args[0]!, ctx));
    if (isError(test)) return test;
    if (test) return args[1]!;
    return args.length > 2 ? args[2]! : false;
  },
);
define(
  {
    name: 'IFS',
    category: 'logical',
    minArgs: 2,
    maxArgs: 254,
    signature: 'IFS(test1, value1, [test2, value2], ...)',
    description: 'Returns the value of the first TRUE test (#N/A when none is TRUE).',
  },
  (args, ctx) => {
    if (args.length % 2 !== 0) return ERR.VALUE;
    for (let i = 0; i < args.length; i += 2) {
      const test = toBoolean(toScalar(args[i]!, ctx));
      if (isError(test)) return test;
      if (test) return args[i + 1]!;
    }
    return ERR.NA;
  },
);
function logical(reduce: (values: boolean[]) => boolean): Impl {
  return (args, ctx) => {
    const values: boolean[] = [];
    const failure = forEachArg(args, ctx, (value, fromRange) => {
      if (isError(value)) return value;
      if (fromRange) {
        if (typeof value === 'boolean') values.push(value);
        else if (typeof value === 'number') values.push(value !== 0);
        return;
      }
      if (value === null) return;
      const b = toBoolean(value);
      if (isError(b)) return b;
      values.push(b);
    });
    if (failure) return failure;
    return values.length === 0 ? ERR.VALUE : reduce(values);
  };
}
define(
  {
    name: 'AND',
    category: 'logical',
    minArgs: 1,
    maxArgs: 255,
    signature: 'AND(logical1, [logical2], ...)',
    description: 'TRUE when every argument is TRUE.',
  },
  logical((values) => values.every(Boolean)),
);
define(
  {
    name: 'OR',
    category: 'logical',
    minArgs: 1,
    maxArgs: 255,
    signature: 'OR(logical1, [logical2], ...)',
    description: 'TRUE when any argument is TRUE.',
  },
  logical((values) => values.some(Boolean)),
);
define(
  {
    name: 'NOT',
    category: 'logical',
    minArgs: 1,
    maxArgs: 1,
    signature: 'NOT(logical)',
    description: 'Reverses a logical value.',
  },
  (args, ctx) => {
    const value = toBoolean(toScalar(args[0]!, ctx));
    return isError(value) ? value : !value;
  },
);
define(
  {
    name: 'IFERROR',
    category: 'logical',
    minArgs: 2,
    maxArgs: 2,
    signature: 'IFERROR(value, value_if_error)',
    description: 'Returns value_if_error when value is an error (#DIV/0!, #N/A…).',
  },
  (args, ctx) => {
    const value = toScalar(args[0]!, ctx);
    return isError(value) ? args[1]! : isRange(args[0]!) ? value : args[0]!;
  },
);

// ---- Lookup ----

define(
  {
    name: 'VLOOKUP',
    category: 'lookup',
    minArgs: 3,
    maxArgs: 4,
    signature: 'VLOOKUP(lookup_value, table_array, col_index_num, [range_lookup])',
    description:
      'Finds a value in the first column of a table and returns the value of another column. Use FALSE for exact match.',
  },
  (args, ctx) => {
    const lookup = toScalar(args[0]!, ctx);
    if (isError(lookup)) return lookup;
    const table = requireRange(args[1]!);
    if (isError(table)) return table;
    const column = int(args[2]!, ctx);
    if (isError(column)) return column;
    if (column < 1) return ERR.VALUE;
    if (column > rangeWidth(table)) return ERR.REF;
    let approx = true;
    if (args.length > 3) {
      const flag = toBoolean(toScalar(args[3]!, ctx));
      if (isError(flag)) return flag;
      approx = flag;
    }
    const first = vector(
      makeRange(table.sheet, table.top, table.left, table.bottom, table.left) as RangeRef,
      ctx,
    );
    if (isError(first)) return first;
    let index = -1;
    if (approx) index = approximate(first.values, lookup, false);
    else {
      const test = exactMatcher(lookup, true);
      index = first.values.findIndex(test);
    }
    if (index < 0) return ERR.NA;
    return ctx.read(table.sheet, table.top + index, table.left + column - 1);
  },
);
define(
  {
    name: 'XLOOKUP',
    category: 'lookup',
    minArgs: 3,
    maxArgs: 6,
    signature:
      'XLOOKUP(lookup_value, lookup_array, return_array, [if_not_found], [match_mode], [search_mode])',
    description:
      'Finds a value in lookup_array and returns the matching item of return_array (match_mode 0 exact, -1 next smaller, 1 next larger, 2 wildcard).',
  },
  (args, ctx, missing) => {
    const lookup = toScalar(args[0]!, ctx);
    if (isError(lookup)) return lookup;
    const lookupRange = requireRange(args[1]!);
    if (isError(lookupRange)) return lookupRange;
    const returnRange = requireRange(args[2]!);
    if (isError(returnRange)) return returnRange;
    const lookupVector = vector(lookupRange, ctx);
    if (isError(lookupVector)) return ERR.VALUE;
    const length = lookupVector.vertical ? rangeHeight(lookupRange) : rangeWidth(lookupRange);
    const returnLength = lookupVector.vertical ? rangeHeight(returnRange) : rangeWidth(returnRange);
    const returnThickness = lookupVector.vertical ? rangeWidth(returnRange) : rangeHeight(returnRange);
    // Spilling a whole row/column of results is not supported: return_array must be one cell thick.
    if (returnLength !== length || returnThickness !== 1) return ERR.VALUE;
    const modeValue = optional(args, 4);
    const mode = modeValue === undefined || toScalar(modeValue, ctx) === null ? 0 : int(modeValue, ctx);
    if (isError(mode)) return mode;
    const searchValue = optional(args, 5);
    const search =
      searchValue === undefined || toScalar(searchValue, ctx) === null ? 1 : int(searchValue, ctx);
    if (isError(search)) return search;
    if (![0, -1, 1, 2].includes(mode) || ![1, -1, 2, -2].includes(search)) return ERR.VALUE;
    const values = lookupVector.values;
    const order = [...values.keys()];
    if (search < 0) order.reverse();
    let index = -1;
    const exact = exactMatcher(lookup, mode === 2);
    index = order.find((i) => exact(values[i]!)) ?? -1;
    if (index < 0 && (mode === -1 || mode === 1)) {
      let best: Scalar = null;
      for (const i of order) {
        const value = values[i]!;
        if (!sameType(value, lookup)) continue;
        const cmp = compareScalars(
          value as Exclude<Scalar, FormulaError>,
          lookup as Exclude<Scalar, FormulaError>,
        );
        if ((mode === -1 && cmp < 0) || (mode === 1 && cmp > 0)) {
          const better =
            best === null ||
            (mode === -1
              ? compareScalars(
                  value as Exclude<Scalar, FormulaError>,
                  best as Exclude<Scalar, FormulaError>,
                ) > 0
              : compareScalars(
                  value as Exclude<Scalar, FormulaError>,
                  best as Exclude<Scalar, FormulaError>,
                ) < 0);
          if (better) {
            best = value;
            index = i;
          }
        }
      }
    }
    if (index < 0) {
      const fallback = optional(args, 3);
      return fallback === undefined || missing.has(3) ? ERR.NA : fallback;
    }
    return lookupVector.vertical
      ? ctx.read(returnRange.sheet, returnRange.top + index, returnRange.left)
      : ctx.read(returnRange.sheet, returnRange.top, returnRange.left + index);
  },
);
define(
  {
    name: 'INDEX',
    category: 'lookup',
    minArgs: 2,
    maxArgs: 3,
    signature: 'INDEX(array, row_num, [column_num])',
    description: 'Returns the cell at a row and column of a range (0 returns the whole row or column).',
  },
  (args, ctx) => {
    const source = args[0]!;
    if (!isRange(source)) {
      const value = toScalar(source, ctx);
      if (isError(value)) return value;
      const r = int(args[1]!, ctx);
      if (isError(r)) return r;
      return r <= 1 ? value : ERR.REF;
    }
    let row = int(args[1]!, ctx);
    if (isError(row)) return row;
    let col: number | FormulaError =
      args.length > 2 && toScalar(args[2]!, ctx) !== null ? int(args[2]!, ctx) : 0;
    if (isError(col)) return col;
    const height = rangeHeight(source);
    const width = rangeWidth(source);
    // A single row with one index selects the column, as in Excel.
    if (args.length < 3 && height === 1 && width > 1) {
      col = row;
      row = 0;
    } else if (args.length < 3 && width === 1) col = 1;
    if (row < 0 || col < 0 || row > height || col > width) return ERR.REF;
    const top = row === 0 ? source.top : source.top + row - 1;
    const bottom = row === 0 ? source.bottom : top;
    const left = col === 0 ? source.left : source.left + col - 1;
    const right = col === 0 ? source.right : left;
    return makeRange(source.sheet, top, left, bottom, right);
  },
);
define(
  {
    name: 'MATCH',
    category: 'lookup',
    minArgs: 2,
    maxArgs: 3,
    signature: 'MATCH(lookup_value, lookup_array, [match_type])',
    description:
      'Position of a value in a row or column (0 exact, 1 largest <= value, -1 smallest >= value).',
  },
  (args, ctx) => {
    const lookup = toScalar(args[0]!, ctx);
    if (isError(lookup)) return lookup;
    const range = requireRange(args[1]!);
    if (isError(range)) return ERR.NA;
    const type = args.length > 2 ? int(args[2]!, ctx) : 1;
    if (isError(type)) return type;
    const data = vector(range, ctx);
    if (isError(data)) return data;
    const index =
      type === 0
        ? data.values.findIndex(exactMatcher(lookup, true))
        : approximate(data.values, lookup, type < 0);
    return index < 0 ? ERR.NA : index + 1;
  },
);

// ---- Text ----

define(
  {
    name: 'CONCAT',
    category: 'text',
    minArgs: 1,
    maxArgs: 255,
    signature: 'CONCAT(text1, [text2], ...)',
    description: 'Joins texts and ranges.',
  },
  (args, ctx) => {
    let out = '';
    const failure = forEachArg(args, ctx, (value) => {
      const piece = toText(value);
      if (isError(piece)) return piece;
      out += piece;
    });
    if (failure) return failure;
    return out.length > 32_767 ? ERR.VALUE : out;
  },
);
define(
  {
    name: 'TEXT',
    category: 'text',
    minArgs: 2,
    maxArgs: 2,
    signature: 'TEXT(value, format_text)',
    description:
      'Formats a number with a format code such as "#,##0.00", "0%" or "dd/mm/yyyy" (invariant separators).',
  },
  (args, ctx) => {
    const value = toScalar(args[0]!, ctx);
    if (isError(value)) return value;
    const code = text(args[1]!, ctx);
    if (isError(code)) return code;
    const input: number | string | boolean =
      value === null ? 0 : typeof value === 'string' ? (parseNumericText(value) ?? value) : value;
    return formatWithCode(input, code);
  },
);
function slice(side: 'left' | 'right'): Impl {
  return (args, ctx) => {
    const value = text(args[0]!, ctx);
    if (isError(value)) return value;
    const count = args.length > 1 && toScalar(args[1]!, ctx) !== null ? int(args[1]!, ctx) : 1;
    if (isError(count)) return count;
    if (count < 0) return ERR.VALUE;
    const chars = [...value];
    return side === 'left' ? chars.slice(0, count).join('') : count === 0 ? '' : chars.slice(-count).join('');
  };
}
define(
  {
    name: 'LEFT',
    category: 'text',
    minArgs: 1,
    maxArgs: 2,
    signature: 'LEFT(text, [num_chars])',
    description: 'First characters of a text.',
  },
  slice('left'),
);
define(
  {
    name: 'RIGHT',
    category: 'text',
    minArgs: 1,
    maxArgs: 2,
    signature: 'RIGHT(text, [num_chars])',
    description: 'Last characters of a text.',
  },
  slice('right'),
);
define(
  {
    name: 'LEN',
    category: 'text',
    minArgs: 1,
    maxArgs: 1,
    signature: 'LEN(text)',
    description: 'Number of characters.',
  },
  (args, ctx) => {
    const value = text(args[0]!, ctx);
    return isError(value) ? value : [...value].length;
  },
);
define(
  {
    name: 'UPPER',
    category: 'text',
    minArgs: 1,
    maxArgs: 1,
    signature: 'UPPER(text)',
    description: 'Converts to upper case.',
  },
  (args, ctx) => {
    const value = text(args[0]!, ctx);
    return isError(value) ? value : value.toUpperCase();
  },
);
define(
  {
    name: 'LOWER',
    category: 'text',
    minArgs: 1,
    maxArgs: 1,
    signature: 'LOWER(text)',
    description: 'Converts to lower case.',
  },
  (args, ctx) => {
    const value = text(args[0]!, ctx);
    return isError(value) ? value : value.toLowerCase();
  },
);
define(
  {
    name: 'TRIM',
    category: 'text',
    minArgs: 1,
    maxArgs: 1,
    signature: 'TRIM(text)',
    description: 'Removes leading, trailing and repeated spaces.',
  },
  (args, ctx) => {
    const value = text(args[0]!, ctx);
    return isError(value) ? value : value.replace(/ +/g, ' ').replace(/^ | $/g, '');
  },
);

// ---- Dates ----

define(
  {
    name: 'DATE',
    category: 'date',
    minArgs: 3,
    maxArgs: 3,
    signature: 'DATE(year, month, day)',
    description: 'Date serial from year, month and day.',
  },
  (args, ctx) => {
    let year = int(args[0]!, ctx);
    if (isError(year)) return year;
    const month = int(args[1]!, ctx);
    if (isError(month)) return month;
    const day = int(args[2]!, ctx);
    if (isError(day)) return day;
    if (year < 0 || year > 9999) return ERR.NUM;
    if (year < 1900) year += 1900;
    const serial = serialFromParts(year, month, day);
    return serial < 0 || serial > MAX_SERIAL ? ERR.NUM : serial;
  },
);
define(
  {
    name: 'TODAY',
    category: 'date',
    minArgs: 0,
    maxArgs: 0,
    signature: 'TODAY()',
    description: 'The workbook calculation date (settings.calculationDate); #N/A when it is not set.',
  },
  (_args, ctx) => ctx.wb.calculationDate ?? ERR.NA,
);
define(
  {
    name: 'EDATE',
    category: 'date',
    minArgs: 2,
    maxArgs: 2,
    signature: 'EDATE(start_date, months)',
    description: 'Same day a number of months before or after a date.',
  },
  (args, ctx) => {
    const start = int(args[0]!, ctx);
    if (isError(start)) return start;
    const months = int(args[1]!, ctx);
    if (isError(months)) return months;
    return addMonths(start, months, false);
  },
);
define(
  {
    name: 'EOMONTH',
    category: 'date',
    minArgs: 2,
    maxArgs: 2,
    signature: 'EOMONTH(start_date, months)',
    description: 'Last day of the month a number of months before or after a date.',
  },
  (args, ctx) => {
    const start = int(args[0]!, ctx);
    if (isError(start)) return start;
    const months = int(args[1]!, ctx);
    if (isError(months)) return months;
    return addMonths(start, months, true);
  },
);
define(
  {
    name: 'NETWORKDAYS',
    category: 'date',
    minArgs: 2,
    maxArgs: 3,
    signature: 'NETWORKDAYS(start_date, end_date, [holidays])',
    description: 'Working days (Monday to Friday) between two dates, inclusive, minus holidays.',
  },
  (args, ctx) => {
    const start = int(args[0]!, ctx);
    if (isError(start)) return start;
    const end = int(args[1]!, ctx);
    if (isError(end)) return end;
    if (start < 0 || end < 0) return ERR.NUM;
    const holidays = new Set<number>();
    if (args.length > 2) {
      const failure = forEachArg([args[2]!], ctx, (value) => {
        if (value === null) return;
        const n = toNumber(value);
        if (isError(n)) return n;
        holidays.add(Math.trunc(n));
      });
      if (failure) return failure;
    }
    const [lo, hi, sign] = start <= end ? [start, end, 1] : [end, start, -1];
    if (hi - lo > 400_000) return ERR.NUM;
    let count = 0;
    for (let day = lo; day <= hi; day++) {
      const dow = dayOfWeek(day);
      if (dow !== 0 && dow !== 6 && !holidays.has(day)) count++;
    }
    return sign * count;
  },
);
define(
  {
    name: 'WEEKDAY',
    category: 'date',
    minArgs: 1,
    maxArgs: 2,
    signature: 'WEEKDAY(serial_number, [return_type])',
    description:
      'Day of the week (return_type 1: Sunday=1 … Saturday=7; 2: Monday=1 … Sunday=7; 3: Monday=0).',
  },
  (args, ctx) => {
    const serial = int(args[0]!, ctx);
    if (isError(serial)) return serial;
    if (serial < 0) return ERR.NUM;
    const type = args.length > 1 && toScalar(args[1]!, ctx) !== null ? int(args[1]!, ctx) : 1;
    if (isError(type)) return type;
    return weekdayNumber(serial, type);
  },
);

/** Supported functions keyed by upper-case name (spec §11.2 subset). */
export const FUNCTIONS: ReadonlyMap<string, FunctionSpec> = new Map(
  SPECS.map((spec) => [spec.name, { ...spec, call: IMPLS.get(spec.name)! }]),
);

export const FUNCTION_NAMES: readonly string[] = SPECS.map((spec) => spec.name);

/** Functions with external effects or macro access, rejected with a specific message (spec §11.2, §16). */
export const PROHIBITED_FUNCTIONS: ReadonlySet<string> = new Set([
  'WEBSERVICE',
  'FILTERXML',
  'ENCODEURL',
  'HYPERLINK',
  'IMPORTDATA',
  'IMPORTXML',
  'IMPORTHTML',
  'IMPORTFEED',
  'IMPORTRANGE',
  'IMAGE',
  'CALL',
  'REGISTER',
  'REGISTER.ID',
  'EXEC',
  'RTD',
  'DDE',
  'INFO',
  'CELL',
  'INDIRECT',
  'OFFSET',
  'EVALUATE',
  'GET.CELL',
  'GET.WORKBOOK',
  'RUN',
]);

/** Common functions outside the subset mapped to supported ways of doing the same thing. */
export const FUNCTION_ALTERNATIVES: Readonly<Record<string, string>> = {
  CONCATENATE: 'CONCAT',
  SUMPRODUCT: 'SUMIFS',
  AVERAGEIF: 'SUMIF / COUNTIF',
  AVERAGEIFS: 'SUMIFS / COUNTIFS',
  COUNTBLANK: 'COUNTIF(range, "")',
  HLOOKUP: 'XLOOKUP',
  LOOKUP: 'XLOOKUP',
  IFNA: 'IFERROR',
  NOW: 'TODAY',
  YEAR: 'TEXT(date, "yyyy")',
  MONTH: 'TEXT(date, "m")',
  DAY: 'TEXT(date, "d")',
  WORKDAY: 'NETWORKDAYS',
  INT: 'ROUNDDOWN',
  TRUNC: 'ROUNDDOWN',
  CEILING: 'ROUNDUP',
  FLOOR: 'ROUNDDOWN',
  MID: 'LEFT / RIGHT',
  SWITCH: 'IFS',
  ISBLANK: 'IF(A1="", ...)',
  ISERROR: 'IFERROR',
};

/** Closest supported function names for a hint. */
export function similarFunctions(name: string, limit = 4): string[] {
  const upper = name.toUpperCase();
  const scored = FUNCTION_NAMES.map((candidate) => {
    let score = levenshtein(upper, candidate);
    if (candidate.startsWith(upper.slice(0, 3)) || upper.startsWith(candidate.slice(0, 3))) score -= 2;
    if (candidate.includes(upper) || upper.includes(candidate)) score -= 2;
    return { candidate, score };
  });
  scored.sort((a, b) => a.score - b.score || a.candidate.localeCompare(b.candidate));
  return scored.slice(0, limit).map((entry) => entry.candidate);
}

function levenshtein(a: string, b: string): number {
  const row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let prev = row[0]!;
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const current = row[j]!;
      row[j] = Math.min(row[j]! + 1, row[j - 1]! + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = current;
    }
  }
  return row[b.length]!;
}

export { FormulaError };
