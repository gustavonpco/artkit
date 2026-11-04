import type { Theme } from '@artkit-ai/core';
import { Plus } from 'lucide-react';
import { type ReactElement, useEffect, useState } from 'react';
import { tr } from '../i18n.js';
import { ChartSvg } from '../react/ChartSvg.js';
import type { ChartElement } from '../schema.js';

export interface TableData {
  header?: string[];
  rows: string[][];
}

export interface TableGridProps {
  table: TableData;
  locale: string;
  disabled?: boolean;
  onChange(table: TableData): void;
}

function columns(table: TableData): number {
  return Math.max(table.header?.length ?? 0, ...table.rows.map((row) => row.length), 1);
}

/** Table edited as a grid of inputs; structural changes apply at once, cell edits on blur. */
export function TableGrid({ table, locale, disabled, onChange }: TableGridProps): ReactElement {
  const [draft, setDraft] = useState(table);
  useEffect(() => setDraft(table), [table]);
  const t = (en: string, pt: string) => tr(locale, en, pt);
  const count = columns(draft);
  const changed = () => JSON.stringify(draft) !== JSON.stringify(table);
  const commit = () => {
    if (changed()) onChange(draft);
  };
  const setCell = (row: number | 'header', col: number, value: string) => {
    setDraft((current) => {
      if (row === 'header')
        return { ...current, header: (current.header ?? []).map((cell, i) => (i === col ? value : cell)) };
      return {
        ...current,
        rows: current.rows.map((cells, r) =>
          r === row ? cells.map((cell, i) => (i === col ? value : cell)) : cells,
        ),
      };
    });
  };
  const structural = (next: TableData) => {
    setDraft(next);
    onChange(next);
  };
  return (
    <div className="ak-slides-grid">
      <table>
        <tbody>
          {draft.header ? (
            <tr>
              {draft.header.map((cell, col) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: positional cells/runs have no identity and never reorder
                <th key={col} scope="col">
                  <input
                    value={cell}
                    disabled={disabled}
                    aria-label={`${t('Header', 'Cabeçalho')} ${col + 1}`}
                    onChange={(event) => setCell('header', col, event.target.value)}
                    onBlur={commit}
                  />
                </th>
              ))}
            </tr>
          ) : null}
          {draft.rows.map((cells, row) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: positional cells/runs have no identity and never reorder
            <tr key={row}>
              {cells.map((cell, col) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: positional cells/runs have no identity and never reorder
                <td key={col}>
                  <input
                    value={cell}
                    disabled={disabled}
                    aria-label={`${t('Row', 'Linha')} ${row + 1}, ${t('column', 'coluna')} ${col + 1}`}
                    onChange={(event) => setCell(row, col, event.target.value)}
                    onBlur={commit}
                  />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      <div className="ak-ctl-buttons">
        <button
          type="button"
          disabled={disabled || draft.rows.length >= 100}
          onClick={() => structural({ ...draft, rows: [...draft.rows, new Array<string>(count).fill('')] })}
        >
          <Plus aria-hidden="true" />
          {t('Row', 'Linha')}
        </button>
        <button
          type="button"
          disabled={disabled || draft.rows.length <= 1}
          onClick={() => structural({ ...draft, rows: draft.rows.slice(0, -1) })}
        >
          {t('− Row', '− Linha')}
        </button>
        <button
          type="button"
          disabled={disabled || count >= 20}
          onClick={() =>
            structural({
              ...(draft.header ? { header: [...draft.header, ''] } : {}),
              rows: draft.rows.map((cells) => [...cells, '']),
            })
          }
        >
          {t('+ Column', '+ Coluna')}
        </button>
        <button
          type="button"
          disabled={disabled || count <= 1}
          onClick={() =>
            structural({
              ...(draft.header ? { header: draft.header.slice(0, -1) } : {}),
              rows: draft.rows.map((cells) => cells.slice(0, -1)),
            })
          }
        >
          {t('− Column', '− Coluna')}
        </button>
        <label className="ak-slides-inline">
          <input
            type="checkbox"
            checked={draft.header !== undefined}
            disabled={disabled}
            onChange={(event) =>
              structural(
                event.target.checked
                  ? { ...draft, header: new Array<string>(count).fill('') }
                  : { rows: draft.rows },
              )
            }
          />
          {t('Header row', 'Linha de cabeçalho')}
        </label>
      </div>
    </div>
  );
}

export type ChartGridData = Pick<ChartElement, 'categories' | 'series'>;

export interface ChartGridProps {
  chart: Pick<
    ChartElement,
    'chartType' | 'categories' | 'series' | 'showValues' | 'legend' | 'title' | 'fontSize'
  >;
  theme: Theme;
  locale: string;
  disabled?: boolean;
  onChange(data: ChartGridData): void;
}

/** Chart data in a small spreadsheet (categories × series) with a live preview of the draft. */
export function ChartGrid({ chart, theme, locale, disabled, onChange }: ChartGridProps): ReactElement {
  const source: ChartGridData = { categories: chart.categories, series: chart.series };
  const [draft, setDraft] = useState(source);
  const [raw, setRaw] = useState<Record<string, string>>({});
  useEffect(() => {
    setDraft({ categories: chart.categories, series: chart.series });
    setRaw({});
  }, [chart.categories, chart.series]);
  const t = (en: string, pt: string) => tr(locale, en, pt);
  const commit = () => {
    if (JSON.stringify(draft) !== JSON.stringify(source)) onChange(draft);
  };
  const structural = (next: ChartGridData) => {
    setDraft(next);
    setRaw({});
    onChange(next);
  };
  const setValue = (s: number, c: number, text: string) => {
    setRaw((current) => ({ ...current, [`${s}:${c}`]: text }));
    const value = Number(text.replace(',', '.'));
    if (text.trim() === '' || !Number.isFinite(value)) return;
    setDraft((current) => ({
      ...current,
      series: current.series.map((series, i) =>
        i === s ? { ...series, values: series.values.map((v, j) => (j === c ? value : v)) } : series,
      ),
    }));
  };
  return (
    <div className="ak-slides-grid ak-slides-chart-grid">
      <div className="ak-slides-chart-preview" aria-hidden="true">
        <ChartSvg chart={{ ...chart, ...draft }} width={4} height={2.4} theme={theme} locale={locale} />
      </div>
      <table>
        <thead>
          <tr>
            <th scope="col">{t('Category', 'Categoria')}</th>
            {draft.series.map((series, s) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: positional cells/runs have no identity and never reorder
              <th key={s} scope="col">
                <input
                  value={series.name}
                  disabled={disabled}
                  aria-label={`${t('Series', 'Série')} ${s + 1}`}
                  onChange={(event) =>
                    setDraft((current) => ({
                      ...current,
                      series: current.series.map((item, i) =>
                        i === s ? { ...item, name: event.target.value } : item,
                      ),
                    }))
                  }
                  onBlur={commit}
                />
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {draft.categories.map((category, c) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: positional cells/runs have no identity and never reorder
            <tr key={c}>
              <th scope="row">
                <input
                  value={category}
                  disabled={disabled}
                  aria-label={`${t('Category', 'Categoria')} ${c + 1}`}
                  onChange={(event) =>
                    setDraft((current) => ({
                      ...current,
                      categories: current.categories.map((item, i) => (i === c ? event.target.value : item)),
                    }))
                  }
                  onBlur={commit}
                />
              </th>
              {draft.series.map((series, s) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: positional cells/runs have no identity and never reorder
                <td key={s}>
                  <input
                    inputMode="decimal"
                    value={raw[`${s}:${c}`] ?? String(series.values[c] ?? 0)}
                    disabled={disabled}
                    aria-label={`${series.name}, ${category}`}
                    onChange={(event) => setValue(s, c, event.target.value)}
                    onBlur={() => {
                      setRaw({});
                      commit();
                    }}
                  />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      <div className="ak-ctl-buttons">
        <button
          type="button"
          disabled={disabled || draft.categories.length >= 100}
          onClick={() =>
            structural({
              categories: [
                ...draft.categories,
                `${t('Category', 'Categoria')} ${draft.categories.length + 1}`,
              ],
              series: draft.series.map((series) => ({ ...series, values: [...series.values, 0] })),
            })
          }
        >
          {t('+ Category', '+ Categoria')}
        </button>
        <button
          type="button"
          disabled={disabled || draft.categories.length <= 1}
          onClick={() =>
            structural({
              categories: draft.categories.slice(0, -1),
              series: draft.series.map((series) => ({ ...series, values: series.values.slice(0, -1) })),
            })
          }
        >
          {t('− Category', '− Categoria')}
        </button>
        <button
          type="button"
          disabled={disabled || draft.series.length >= 12 || chart.chartType === 'pie'}
          onClick={() =>
            structural({
              categories: draft.categories,
              series: [
                ...draft.series,
                {
                  name: `${t('Series', 'Série')} ${draft.series.length + 1}`,
                  values: draft.categories.map(() => 0),
                },
              ],
            })
          }
        >
          {t('+ Series', '+ Série')}
        </button>
        <button
          type="button"
          disabled={disabled || draft.series.length <= 1}
          onClick={() => structural({ categories: draft.categories, series: draft.series.slice(0, -1) })}
        >
          {t('− Series', '− Série')}
        </button>
      </div>
    </div>
  );
}
