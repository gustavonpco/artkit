import { ArtifactError } from '@artkit-ai/core';
import {
  Direction,
  HorizontalAlign,
  type ICellData,
  ICommandService,
  type IRange,
  IUniverInstanceService,
  LifecycleService,
  LifecycleStages,
  LocaleType,
  Univer,
  UniverInstanceType,
  WrapStrategy,
} from '@univerjs/core';
import {
  FormulaExecuteStageType,
  IFormulaRuntimeService,
  UniverFormulaEnginePlugin,
} from '@univerjs/engine-formula';
import {
  AddWorksheetMergeCommand,
  InsertColCommand,
  InsertRowCommand,
  InsertSheetCommand,
  RemoveColCommand,
  RemoveRowCommand,
  RemoveSheetCommand,
  RemoveWorksheetMergeCommand,
  SetColWidthCommand,
  SetFrozenCommand,
  SetRangeValuesCommand,
  SetRowHeightCommand,
  SetStyleCommand,
  SetWorksheetNameCommand,
  SetWorksheetOrderCommand,
  UniverSheetsPlugin,
} from '@univerjs/sheets';
import { UniverSheetsFormulaPlugin } from '@univerjs/sheets-formula';
import type { SheetEngine } from './engine.js';
import type { WorkbookContent } from './model.js';
import type { ResolvedOperation, SheetStyle } from './operations.js';

const DEFAULT_TIMEOUT_MS = 10_000;
const UNIT_ID = 'artkit-workbook';

function localeOf(tag: string | undefined): LocaleType {
  return tag?.toLowerCase().startsWith('pt') ? LocaleType.PT_BR : LocaleType.EN_US;
}

function cellFor(value: string | number | boolean | null): ICellData {
  if (value === null) return { v: null };
  if (typeof value === 'string' && value.startsWith('=')) return { f: value };
  return { v: value };
}

function fullRange(row: number, _column: number, _rowCount: number, columnCount: number): IRange {
  return { startRow: row, endRow: row, startColumn: 0, endColumn: columnCount - 1 };
}

/** Maps a resolved operation to Univer commands (spec §11.4). Returns the commands to run in order. */
function commandsFor(
  op: ResolvedOperation,
  sheet: { rowCount: number; columnCount: number },
): { id: string; params: Record<string, unknown> }[] {
  const base = { unitId: UNIT_ID };
  switch (op.kind) {
    case 'set_values': {
      const value = op.values.map((row) => row.map(cellFor));
      const range: IRange = {
        startRow: op.row,
        endRow: op.row + op.values.length - 1,
        startColumn: op.column,
        endColumn: op.column + Math.max(0, ...op.values.map((row) => row.length)) - 1,
      };
      return [{ id: SetRangeValuesCommand.id, params: { ...base, subUnitId: op.sheetId, range, value } }];
    }
    case 'set_format':
      return [
        {
          id: SetStyleCommand.id,
          params: {
            ...base,
            subUnitId: op.sheetId,
            range: op.range,
            style: { type: 'n', value: { pattern: op.pattern } },
          },
        },
      ];
    case 'set_style':
      return styleCommands(op.sheetId, op.range, op.style);
    case 'insert_rows':
      return [
        {
          id: InsertRowCommand.id,
          params: {
            ...base,
            subUnitId: op.sheetId,
            direction: Direction.UP,
            range: {
              startRow: op.at,
              endRow: op.at + op.count - 1,
              startColumn: 0,
              endColumn: sheet.columnCount - 1,
            },
          },
        },
      ];
    case 'delete_rows':
      return [
        {
          id: RemoveRowCommand.id,
          params: {
            ...base,
            subUnitId: op.sheetId,
            range: {
              startRow: op.from,
              endRow: op.from + op.count - 1,
              startColumn: 0,
              endColumn: sheet.columnCount - 1,
            },
          },
        },
      ];
    case 'insert_columns':
      return [
        {
          id: InsertColCommand.id,
          params: {
            ...base,
            subUnitId: op.sheetId,
            direction: Direction.LEFT,
            range: {
              startRow: 0,
              endRow: sheet.rowCount - 1,
              startColumn: op.at,
              endColumn: op.at + op.count - 1,
            },
          },
        },
      ];
    case 'delete_columns':
      return [
        {
          id: RemoveColCommand.id,
          params: {
            ...base,
            subUnitId: op.sheetId,
            range: {
              startRow: 0,
              endRow: sheet.rowCount - 1,
              startColumn: op.from,
              endColumn: op.from + op.count - 1,
            },
          },
        },
      ];
    case 'add_sheet':
      return [
        {
          id: InsertSheetCommand.id,
          params: {
            ...base,
            index: op.index ?? 9999,
            sheet: { id: op.sheetId, name: op.name, rowCount: 100, columnCount: 26, cellData: {} },
          },
        },
      ];
    case 'rename_sheet':
      return [{ id: SetWorksheetNameCommand.id, params: { ...base, subUnitId: op.sheetId, name: op.name } }];
    case 'move_sheet':
      return [
        { id: SetWorksheetOrderCommand.id, params: { ...base, subUnitId: op.sheetId, order: op.index } },
      ];
    case 'remove_sheet':
      return [{ id: RemoveSheetCommand.id, params: { ...base, subUnitId: op.sheetId } }];
    case 'merge':
      return [
        {
          id: AddWorksheetMergeCommand.id,
          params: { ...base, subUnitId: op.sheetId, selections: [op.range], defaultMerge: true },
        },
      ];
    case 'unmerge':
      return [
        {
          id: RemoveWorksheetMergeCommand.id,
          params: { ...base, subUnitId: op.sheetId, ranges: [op.range] },
        },
      ];
    case 'set_column_width':
      return [
        {
          id: SetColWidthCommand.id,
          params: {
            ...base,
            subUnitId: op.sheetId,
            ranges: [
              { startRow: 0, endRow: sheet.rowCount - 1, startColumn: op.column, endColumn: op.column },
            ],
            value: op.width,
          },
        },
      ];
    case 'set_row_height':
      return [
        {
          id: SetRowHeightCommand.id,
          params: {
            ...base,
            subUnitId: op.sheetId,
            ranges: [fullRange(op.row, 0, sheet.rowCount, sheet.columnCount)],
            value: op.height,
          },
        },
      ];
    case 'set_frozen':
      return [
        {
          id: SetFrozenCommand.id,
          params: {
            ...base,
            subUnitId: op.sheetId,
            startRow: op.rows,
            startColumn: op.columns,
            ySplit: op.rows,
            xSplit: op.columns,
          },
        },
      ];
    case 'set_validation':
      // Validation rules belong to the format content, not to the Univer snapshot: the adapter keeps them.
      return [];
    case 'clear_range': {
      const width = op.range.endColumn - op.range.startColumn + 1;
      const height = op.range.endRow - op.range.startRow + 1;
      // `all` also drops the cell style: a cell with neither value nor style disappears from the snapshot.
      const cleared = op.what === 'all' ? ({ v: null, s: null } as ICellData) : ({ v: null } as ICellData);
      const empty = Array.from({ length: height }, () =>
        Array.from({ length: width }, () => ({ ...cleared })),
      );
      return [
        {
          id: SetRangeValuesCommand.id,
          params: { ...base, subUnitId: op.sheetId, range: op.range, value: empty },
        },
      ];
    }
  }
}

function styleCommands(
  sheetId: string,
  range: IRange,
  style: SheetStyle,
): { id: string; params: Record<string, unknown> }[] {
  const base = { unitId: UNIT_ID, subUnitId: sheetId, range };
  const commands: { id: string; params: Record<string, unknown> }[] = [];
  const push = (type: string, value: unknown) =>
    commands.push({ id: SetStyleCommand.id, params: { ...base, style: { type, value } } });
  if (style.bold !== undefined) push('bl', style.bold ? 1 : 0);
  if (style.italic !== undefined) push('it', style.italic ? 1 : 0);
  if (style.color !== undefined) push('cl', { rgb: style.color });
  if (style.background !== undefined) push('bg', { rgb: style.background });
  if (style.align !== undefined) {
    push(
      'ht',
      style.align === 'left'
        ? HorizontalAlign.LEFT
        : style.align === 'center'
          ? HorizontalAlign.CENTER
          : HorizontalAlign.RIGHT,
    );
  }
  if (style.wrap !== undefined) push('tb', style.wrap ? WrapStrategy.WRAP : WrapStrategy.OVERFLOW);
  return commands;
}

/** Waits until the formula engine is idle and every formula cell has a computed value (deterministic result, bounded wait). */
async function settle(
  runtime: IFormulaRuntimeService,
  snapshot: () => WorkbookContent,
  timeoutMs: number,
): Promise<void> {
  const started = Date.now();
  for (;;) {
    const stage = runtime.getFormulaExecuteStage();
    const idle =
      stage === FormulaExecuteStageType.IDLE || stage === FormulaExecuteStageType.CALCULATION_COMPLETED;
    if (idle && pendingFormulas(snapshot()) === 0) return;
    if (Date.now() - started > timeoutMs) {
      throw new ArtifactError('ENGINE_UNAVAILABLE', 'O motor de cálculo não terminou a tempo.', {
        issues: [
          {
            path: 'content',
            message: 'O recálculo excedeu o tempo limite.',
            hint: 'Reduza o número de fórmulas por lote.',
          },
        ],
      });
    }
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

function pendingFormulas(content: WorkbookContent): number {
  let pending = 0;
  for (const sheet of Object.values(content.sheets)) {
    for (const row of Object.values(sheet.cellData)) {
      for (const cell of Object.values(row))
        if (cell.f && (cell.v === undefined || cell.v === null)) pending += 1;
    }
  }
  return pending;
}

/** A Univer instance kept for reuse: it is created once and only its workbook units come and go per batch. */
interface UniverHost {
  univer: Univer;
  injector: ReturnType<Univer['__getInjector']>;
}

function createHost(locale: string | undefined): UniverHost {
  const univer = new Univer({
    locale: localeOf(locale),
    locales: { [LocaleType.PT_BR]: {}, [LocaleType.EN_US]: {} },
  });
  univer.registerPlugin(UniverFormulaEnginePlugin);
  univer.registerPlugin(UniverSheetsPlugin);
  univer.registerPlugin(UniverSheetsFormulaPlugin);
  return { univer, injector: univer.__getInjector() };
}

/**
 * The formula engine starts recalculating only when the lifecycle reaches `Rendered`, a stage the UI normally reaches.
 * Node starts recalculation regardless, but a browser without a UI never gets there, so the headless engine advances
 * the stage itself once a unit exists (Univer moves to `Ready` on the first unit and runs the plugins' `onReady`).
 */
function ensureRendered(injector: UniverHost['injector']): void {
  const lifecycle = injector.get(LifecycleService);
  if (lifecycle.stage < LifecycleStages.Rendered) lifecycle.stage = LifecycleStages.Rendered;
}

export interface UniverEngine extends SheetEngine {
  /** Releases the Univer instance. The engine can still be used: the next batch creates a new one. */
  close(): void;
}

/**
 * Univer headless engine (spec §11.1, §21). One Univer instance serves every batch of the engine, batches run one at a
 * time, and each batch's workbook unit is disposed afterwards, so nothing leaks between batches.
 */
export function createUniverEngine(): UniverEngine {
  let host: UniverHost | undefined;
  let queue: Promise<unknown> = Promise.resolve();

  async function run(
    content: WorkbookContent,
    operations: ResolvedOperation[],
    options: { locale: string; timeoutMs?: number },
  ) {
    host ??= createHost(content.locale);
    const { injector } = host;
    const units = injector.get(IUniverInstanceService);
    const timeout = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    try {
      host.univer.createUnit(UniverInstanceType.UNIVER_SHEET, {
        ...structuredClone(content),
        id: UNIT_ID,
      } as never);
      const unit = units.getUnit(UNIT_ID);
      if (!unit)
        throw new ArtifactError('ENGINE_UNAVAILABLE', 'Não foi possível carregar a planilha no motor.');
      ensureRendered(injector);
      const snapshot = () => unit.getSnapshot() as unknown as WorkbookContent;
      const runtime = injector.get(IFormulaRuntimeService);
      const commands = injector.get(ICommandService);
      await settle(runtime, snapshot, timeout);
      for (const op of operations) {
        const current = snapshot();
        const sheet = ('sheetId' in op && current.sheets[op.sheetId]) || { rowCount: 100, columnCount: 26 };
        for (const command of commandsFor(op, sheet as { rowCount: number; columnCount: number })) {
          const ok = await commands.executeCommand(command.id, command.params);
          if (!ok) {
            throw new ArtifactError('OPERATION_FAILED', `O motor recusou a operação ${op.kind}.`, {
              issues: [
                {
                  path: `operations.${op.kind}`,
                  message: `O motor recusou a operação ${op.kind}.`,
                  hint: 'Confira a aba e o intervalo.',
                },
              ],
            });
          }
        }
        await settle(runtime, snapshot, timeout);
      }
      // Univer returns live references that disposing the unit empties, so copy before releasing it. Its snapshot
      // reports its own default locale, so the locale of the content is put back.
      const result = structuredClone(snapshot());
      if (content.locale === undefined) delete result.locale;
      else result.locale = content.locale;
      return result;
    } finally {
      units.disposeUnit(UNIT_ID);
    }
  }

  return {
    execute(content, operations, options) {
      const next = queue.then(() => run(content, operations, options));
      queue = next.catch(() => undefined);
      return next;
    },
    close() {
      host?.univer.dispose();
      host = undefined;
    },
  };
}
