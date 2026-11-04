import type { CreateRequest } from '@artkit/core';
import { columnLetter, type NamedFormat, serialFromIso } from '@artkit/kind-sheet';
import type { WorkiaCronograma, WorkiaPlanilha } from './types.js';

export interface SheetPlan {
  request: CreateRequest;
  /** Applied right after creation: computed columns are filled from one model formula (fill_range). */
  operations: unknown[];
}

const FORMATS: Record<string, NamedFormat> = {
  moeda: 'currency',
  percentual: 'percent',
  data: 'date',
  inteiro: 'integer',
  numero: 'general',
};

/**
 * planilha → sheet. Parameters become named cells on a "Parametros" sheet, computed columns a formula
 * copied with fill_range, declarative totals SUM, grouped totals SUMIF and formula totals plain formulas.
 */
export function planilhaPlan(source: WorkiaPlanilha): SheetPlan {
  const params = {
    id: 'parametros',
    name: 'Parametros',
    cells: Object.fromEntries(
      source.parametros.flatMap((param, i) => [
        [`A${i + 1}`, { v: param.rotulo }],
        [`B${i + 1}`, { v: param.valor, fmt: FORMATS[param.tipo] ?? 'general' }],
      ]),
    ),
  };
  // Column A holds the row group; data columns start at B.
  const columns = [{ id: 'grupo', rotulo: 'Grupo', tipo: 'texto' }, ...source.colunas];
  const letter = new Map(columns.map((column, i) => [column.id, columnLetter(i)]));
  const last = source.linhas.length + 1;
  const cells: Record<string, unknown> = {};
  columns.forEach((column, i) => {
    cells[`${columnLetter(i)}1`] = { v: column.rotulo, s: { bold: true } };
  });
  source.linhas.forEach((row, r) => {
    cells[`A${r + 2}`] = { v: row.grupo ?? '' };
    for (const column of source.colunas) {
      const value = row.celulas[column.id];
      if (value === undefined || column.formula) continue;
      const format = FORMATS[column.tipo];
      cells[`${letter.get(column.id)}${r + 2}`] = {
        v: format === 'date' && typeof value === 'string' ? serialFromIso(value) : value,
        ...(format ? { fmt: format } : {}),
      };
    }
  });
  const rowFormula = (formula: string, row: number) =>
    formula
      .replace(/param\((\w+)\)/g, '$1')
      .replace(/\b([a-z_]\w*)\b/g, (word) => (letter.has(word) ? `${letter.get(word)}${row}` : word));
  const totalFormula = (formula: string) =>
    formula
      .replace(/param\((\w+)\)/g, '$1')
      .replace(/soma\((\w+)\)/g, (_, id: string) => `SUM(${letter.get(id)}2:${letter.get(id)}${last})`);

  const operations: unknown[] = [];
  for (const column of source.colunas.filter((c) => c.formula)) {
    const col = letter.get(column.id)!;
    operations.push({
      op: 'set_cells',
      sheet: 'estimativa',
      cells: { [`${col}2`]: { f: rowFormula(column.formula!, 2), fmt: FORMATS[column.tipo] } },
    });
    operations.push({
      op: 'fill_range',
      sheet: 'estimativa',
      source: `${col}2`,
      target: `${col}2:${col}${last}`,
    });
  }
  const totals: Record<string, unknown> = {};
  let row = last + 2;
  for (const total of source.totais) {
    const columnType = source.colunas.find((c) => c.id === total.coluna)?.tipo;
    const format = total.formato ? FORMATS[total.formato] : columnType ? FORMATS[columnType] : 'currency';
    const col = letter.get(total.coluna ?? '') ?? columnLetter(columns.length - 1);
    if (total.agruparPor) {
      const groupCol = letter.get(total.agruparPor) ?? 'A';
      for (const group of [...new Set(source.linhas.map((line) => line.grupo ?? ''))]) {
        totals[`A${row}`] = { v: `${total.rotulo}: ${group}` };
        totals[`B${row}`] = { v: group };
        // Bounded ranges: a whole column would include the total itself (circular reference).
        totals[`${col}${row}`] = {
          f: `SUMIF($${groupCol}$2:$${groupCol}$${last},B${row},$${col}$2:$${col}$${last})`,
          ...(format && format !== 'general' ? { fmt: format } : {}),
        };
        row++;
      }
      continue;
    }
    const formula = total.op === 'formula' ? totalFormula(total.formula!) : `SUM(${col}2:${col}${last})`;
    totals[`A${row}`] = { v: total.rotulo, s: { bold: true } };
    totals[`${col}${row}`] = { f: formula, ...(format && format !== 'general' ? { fmt: format } : {}) };
    row++;
  }
  operations.push({ op: 'set_cells', sheet: 'estimativa', cells: totals });
  if (source.notas) {
    operations.push({
      op: 'set_cells',
      sheet: 'estimativa',
      cells: { [`A${row + 1}`]: { v: source.notas, s: { wrap: true } } },
    });
  }
  return {
    request: {
      kind: 'sheet',
      title: source.titulo,
      content: {
        sheets: [params, { id: 'estimativa', name: 'Estimativa', frozen: { rows: 1, cols: 0 }, cells }],
        names: source.parametros.map((param, i) => ({ name: param.id, ref: `Parametros!$B$${i + 1}` })),
        ...(source.moeda ? { settings: { currency: source.moeda } } : {}),
      },
    },
    operations,
  };
}

// ---------------------------------------------------------------------------------------- cronograma

interface ScheduledTask {
  id: string;
  start: string;
  end: string;
}

function isoDay(iso: string): Date {
  return new Date(`${iso}T00:00:00Z`);
}

function toIso(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** Working-day calendar: ISO weekdays (1 = Monday … 7 = Sunday) and holidays. */
class Calendar {
  readonly #days: Set<number>;
  readonly #holidays: Set<string>;

  constructor(days: number[], holidays: string[]) {
    this.#days = new Set(days);
    this.#holidays = new Set(holidays);
  }

  isWorking(date: Date): boolean {
    const weekday = date.getUTCDay() === 0 ? 7 : date.getUTCDay();
    return this.#days.has(weekday) && !this.#holidays.has(toIso(date));
  }

  /** First working day on or after `date`. */
  align(date: Date): Date {
    const out = new Date(date);
    while (!this.isWorking(out)) out.setUTCDate(out.getUTCDate() + 1);
    return out;
  }

  /** Moves `count` working days (negative goes back). */
  add(date: Date, count: number): Date {
    const out = new Date(date);
    const step = count < 0 ? -1 : 1;
    let left = Math.abs(count);
    while (left > 0) {
      out.setUTCDate(out.getUTCDate() + step);
      if (this.isWorking(out)) left--;
    }
    return out;
  }
}

/**
 * Forward pass of the critical path method over working days. A task of N days starting on day S ends on
 * S + N − 1; milestones (0 days) sit on the date their constraints give. FS starts the next working day
 * after the predecessor ends, SS from its start, FF/SF align the end; lags are working days.
 */
export function scheduleCronograma(source: WorkiaCronograma): ScheduledTask[] {
  const calendar = new Calendar(source.calendario.diasUteis, source.calendario.feriados);
  const byId = new Map(source.tarefas.map((task) => [task.id, task]));
  const done = new Map<string, { start: Date; end: Date }>();
  const visiting = new Set<string>();
  const visit = (id: string): { start: Date; end: Date } => {
    const cached = done.get(id);
    if (cached) return cached;
    if (visiting.has(id)) throw new Error(`Circular dependency at task ${id}`);
    visiting.add(id);
    const task = byId.get(id);
    if (!task) throw new Error(`Unknown task ${id}`);
    const duration = Math.max(0, task.duracaoDias);
    let start = calendar.align(isoDay(source.inicio));
    let milestoneDate: Date | undefined;
    for (const dep of task.dependencias) {
      const pred = visit(dep.tarefaId);
      const lag = dep.defasagemDias ?? 0;
      let candidate: Date;
      if (dep.tipo === 'SS') candidate = calendar.add(pred.start, lag);
      else if (dep.tipo === 'FF')
        candidate = calendar.add(calendar.add(pred.end, lag), -(Math.max(duration, 1) - 1));
      else if (dep.tipo === 'SF')
        candidate = calendar.add(calendar.add(pred.start, lag), -(Math.max(duration, 1) - 1));
      else {
        // FS: milestones land on the predecessor's finish; tasks start the next working day.
        candidate = duration === 0 ? calendar.add(pred.end, lag) : calendar.add(pred.end, 1 + lag);
      }
      if (duration === 0)
        milestoneDate = !milestoneDate || candidate > milestoneDate ? candidate : milestoneDate;
      else if (candidate > start) start = calendar.align(candidate);
    }
    const result =
      duration === 0
        ? { start: milestoneDate ?? start, end: milestoneDate ?? start }
        : { start, end: calendar.add(start, duration - 1) };
    visiting.delete(id);
    done.set(id, result);
    return result;
  };
  return source.tarefas.map((task) => {
    const { start, end } = visit(task.id);
    return { id: task.id, start: toIso(start), end: toIso(end) };
  });
}

/**
 * cronograma → sheet. Dates are computed once at migration (forward pass with the working calendar) and
 * stored as values; a "Dias úteis" column recomputes the duration with NETWORKDAYS and the holidays
 * range, so edits to dates are checked against durations. The sheet kind has no WORKDAY (outside the spec
 * subset), so moving a date does not cascade to successors: that is the job of a future `timeline` kind.
 */
export function cronogramaPlan(source: WorkiaCronograma): SheetPlan {
  const schedule = new Map(scheduleCronograma(source).map((item) => [item.id, item]));
  const header = [
    'Tarefa',
    'Grupo',
    'Responsável',
    'Duração (dias)',
    'Início',
    'Fim',
    'Dependências',
    'Dias úteis',
  ];
  const cells: Record<string, unknown> = {};
  header.forEach((label, i) => {
    cells[`${columnLetter(i)}1`] = { v: label, s: { bold: true } };
  });
  source.tarefas.forEach((task, i) => {
    const row = i + 2;
    const dates = schedule.get(task.id)!;
    cells[`A${row}`] = {
      v: task.marco ? `◆ ${task.nome}` : task.nome,
      ...(task.descricao ? { note: task.descricao } : {}),
    };
    if (task.grupo) cells[`B${row}`] = { v: task.grupo };
    if (task.responsavel) cells[`C${row}`] = { v: task.responsavel };
    cells[`D${row}`] = { v: task.duracaoDias, fmt: 'integer' };
    cells[`E${row}`] = { v: serialFromIso(dates.start), fmt: 'date' };
    cells[`F${row}`] = { v: serialFromIso(dates.end), fmt: 'date' };
    if (task.dependencias.length > 0) {
      cells[`G${row}`] = {
        v: task.dependencias
          .map((dep) => `${dep.tarefaId} ${dep.tipo}${dep.defasagemDias ? `+${dep.defasagemDias}` : ''}`)
          .join(', '),
      };
    }
    if (!task.marco) cells[`H${row}`] = { f: `NETWORKDAYS(E${row},F${row},feriados)`, fmt: 'integer' };
  });
  const holidays = source.calendario.feriados;
  const calendarCells: Record<string, unknown> = {
    A1: { v: 'Feriados', s: { bold: true } },
    ...Object.fromEntries(holidays.map((iso, i) => [`A${i + 2}`, { v: serialFromIso(iso), fmt: 'date' }])),
    C1: { v: 'Dias úteis (ISO)', s: { bold: true } },
    C2: { v: source.calendario.diasUteis.join(', ') },
  };
  const operations: unknown[] = source.notas
    ? [
        {
          op: 'set_cells',
          sheet: 'cronograma',
          cells: { [`A${source.tarefas.length + 3}`]: { v: source.notas } },
        },
      ]
    : [];
  return {
    request: {
      kind: 'sheet',
      title: source.titulo,
      content: {
        sheets: [
          {
            id: 'cronograma',
            name: 'Cronograma',
            frozen: { rows: 1, cols: 1 },
            columns: { A: { width: 28 }, G: { width: 18 } },
            cells,
          },
          { id: 'calendario', name: 'Calendario', cells: calendarCells },
        ],
        names: [{ name: 'feriados', ref: `Calendario!$A$2:$A$${Math.max(2, holidays.length + 1)}` }],
      },
    },
    operations,
  };
}
