import type { EditorBindings } from '@artkit-ai/core';
import { deepEqual } from '@artkit-ai/core';
import {
  CommandType,
  DataValidationType,
  generateRandomId,
  type IWorkbookData,
  mergeLocales,
} from '@univerjs/core';
import { UniverSheetsCorePreset } from '@univerjs/preset-sheets-core';
import sheetsCoreEnUS from '@univerjs/preset-sheets-core/locales/en-US';
import sheetsCorePtBR from '@univerjs/preset-sheets-core/locales/pt-BR';
import { UniverSheetsDataValidationPreset } from '@univerjs/preset-sheets-data-validation';
import { createUniver, type FUniver, LocaleType } from '@univerjs/presets';
import { AddSheetDataValidationCommand } from '@univerjs/sheets-data-validation';
import { useEffect, useRef } from 'react';
import { parseRange } from '../a1.js';
import { findSheet, type WorkbookContent } from '../model.js';
import type { SheetEditOperation } from './components.js';
import { applyStructural, operationsBetween, structuralOperation } from './operations-from-grid.js';
import { applyUniverTheme, univerThemeFrom } from './univer-theme.js';

/** Commands that only move the view (selection, scroll, focus) never change the workbook. */
const VIEW_ONLY = /selection|scroll|activate|focus|hover|active|select|zoom|viewport|resize/i;

const clone = <T,>(value: T): T => structuredClone(value);

/** Makes `data` the current workbook. The preset's default workbook is only disposed after the first load. */
function loadInto(
  api: FUniver,
  data: WorkbookContent,
  first: boolean,
  base: { current: WorkbookContent },
): void {
  const previous = api.getActiveWorkbook();
  const workbook = api.createWorkbook(clone(data) as unknown as Partial<IWorkbookData>, {
    makeCurrent: true,
  });
  if (!first && previous && previous.getId() !== data.id) api.disposeUnit(previous.getId());
  base.current = clone(data);
  void showDropdowns(api, workbook.getId(), data);
}

/**
 * Shows the dropdown rules of the content in the grid (spec §11.4 `set_validation`). The rules are only read from the
 * content: a dropdown the user creates in the grid is not reported back.
 */
async function showDropdowns(api: FUniver, unitId: string, data: WorkbookContent): Promise<void> {
  for (const rule of data.validations ?? []) {
    const range = parseRange(rule.range);
    const sheet = findSheet(data, rule.sheet);
    if (!range || !sheet) continue;
    await api.executeCommand(AddSheetDataValidationCommand.id, {
      unitId,
      subUnitId: sheet.id,
      rule: {
        uid: generateRandomId(6),
        type: DataValidationType.LIST,
        formula1: `"${rule.list.join(',')}"`,
        ranges: [range],
        allowBlank: true,
        showErrorMessage: true,
      },
    });
  }
}

function snapshotOf(api: FUniver | undefined): WorkbookContent | undefined {
  const workbook = api?.getActiveWorkbook();
  if (!workbook) return undefined;
  return clone(workbook.save() as unknown as WorkbookContent);
}

export interface UniverSheetEditorProps extends EditorBindings<WorkbookContent, SheetEditOperation> {
  className?: string;
  /** Height of the editor area (CSS length). */
  height?: string;
}

/**
 * Spreadsheet editor on Univer's open-core preset (spec §11.6). Every user change is read from the grid and sent as
 * operations relative to the last state the editor reported; structural changes (rows and columns) come from their
 * commands with positions. The application loads `@univerjs/preset-sheets-core/lib/index.css` once.
 */
export function UniverSheetEditor({
  content,
  emit,
  readOnly,
  ctx,
  className,
  height = '560px',
}: UniverSheetEditorProps) {
  const container = useRef<HTMLDivElement>(null);
  const apiRef = useRef<{ univer: { dispose(): void }; api: FUniver } | null>(null);
  const base = useRef<WorkbookContent>(content);
  const emitRef = useRef(emit);
  emitRef.current = emit;

  // The grid is created once; theme changes (light and dark) are applied to the running instance by the effect below.
  // biome-ignore lint/correctness/useExhaustiveDependencies: content changes are applied by the effect below.
  useEffect(() => {
    if (!container.current) return undefined;
    const parent = container.current;
    // Creation waits one tick: React's StrictMode mounts, unmounts and mounts again at once, and the first pass is
    // cancelled before Univer starts. Only a real unmount disposes an instance, outside React's render.
    let created:
      | { univer: { dispose(): void }; api: FUniver; subscription: { dispose(): void }; host: HTMLElement }
      | undefined;
    const timer = setTimeout(() => {
      const host = document.createElement('div');
      host.style.height = '100%';
      host.style.width = '100%';
      parent.appendChild(host);
      const pt = ctx.locale.toLowerCase().startsWith('pt');
      const { univer, univerAPI } = createUniver({
        locale: pt ? LocaleType.PT_BR : LocaleType.EN_US,
        theme: univerThemeFrom(ctx.theme),
        locales: {
          [LocaleType.PT_BR]: mergeLocales(sheetsCorePtBR),
          [LocaleType.EN_US]: mergeLocales(sheetsCoreEnUS),
        },
        presets: [UniverSheetsCorePreset({ container: host }), UniverSheetsDataValidationPreset()],
      });
      loadInto(univerAPI, content, true, base);
      applyUniverTheme(univerAPI, ctx.theme);
      const subscription = univerAPI.addEvent(univerAPI.Event.CommandExecuted, (event) => {
        if (event.type !== CommandType.COMMAND || VIEW_ONLY.test(event.id)) return;
        const live = snapshotOf(univerAPI);
        if (!live) return;
        const structural = structuralOperation(event.id, event.params as never, base.current);
        if (structural) {
          emitRef.current([structural], { kind: 'discrete' });
          base.current = applyStructural(base.current, structural);
        }
        const operations = operationsBetween(base.current, live);
        if (operations.length > 0) emitRef.current(operations, { kind: 'typing' });
        base.current = live;
      });
      created = { univer, api: univerAPI, subscription, host };
      apiRef.current = { univer, api: univerAPI };
    }, 0);
    return () => {
      clearTimeout(timer);
      apiRef.current = null;
      const instance = created;
      created = undefined;
      if (!instance) return;
      setTimeout(() => {
        instance.subscription.dispose();
        instance.univer.dispose();
        instance.host.remove();
      }, 0);
    };
  }, []);

  // A change of the artkit theme (light or dark) is applied to the running grid: colors and the dark flag.
  const themeKey = JSON.stringify(ctx.theme.colors);
  const themeRef = useRef(ctx.theme);
  themeRef.current = ctx.theme;
  // biome-ignore lint/correctness/useExhaustiveDependencies: the effect runs when the colors of the theme change.
  useEffect(() => {
    if (apiRef.current) applyUniverTheme(apiRef.current.api, themeRef.current);
  }, [themeKey]);

  useEffect(() => {
    const current = apiRef.current;
    if (!current) return;
    const live = snapshotOf(current.api);
    if (live && operationsBetween(content, live).length === 0) {
      base.current = clone(content);
      return;
    }
    if (live && deepEqual(content, live)) return;
    loadInto(current.api, content, false, base);
  }, [content]);

  return (
    <div
      className={`ak-sheet-univer${className ? ` ${className}` : ''}`}
      style={{ height, pointerEvents: readOnly ? 'none' : undefined }}
      data-readonly={readOnly || undefined}
      data-locale={ctx.locale}
    >
      <div ref={container} style={{ height: '100%', width: '100%' }} />
    </div>
  );
}

/**
 * Chrome of the Univer editor in the artkit design: the frame takes the card radius and hairline, and the interface text
 * (ribbon, formula bar, tabs, menus) takes the body font. Colors come from the theme built in `univer-theme.ts`.
 */
export const univerCss = `
.ak-sheet-univer { border: 1px solid var(--ak-color-border-soft); border-radius: var(--ak-radius-card, 12px); overflow: hidden; background: var(--ak-color-background); }
.ak-sheet-univer [class*="univer-"] { font-family: var(--ak-font-body); }
.ak-sheet-univer [class*="univer-"] button { border-radius: var(--ak-radius-sm, 6px); }
`;
