import type { ChartElement } from './schema.js';

export interface Scale {
  min: number;
  max: number;
  ticks: number[];
}

function niceStep(range: number, targetTicks: number): number {
  const rough = range / Math.max(1, targetTicks);
  const power = 10 ** Math.floor(Math.log10(rough));
  const fraction = rough / power;
  const nice = fraction <= 1 ? 1 : fraction <= 2 ? 2 : fraction <= 2.5 ? 2.5 : fraction <= 5 ? 5 : 10;
  return nice * power;
}

/** Axis scale with "nice" round ticks that always includes zero (bar charts start at the baseline). */
export function niceScale(minValue: number, maxValue: number, targetTicks = 5): Scale {
  let min = Math.min(0, minValue);
  let max = Math.max(0, maxValue);
  if (min === max) max = min + 1;
  const step = niceStep(max - min, targetTicks);
  min = Math.floor(min / step) * step;
  max = Math.ceil(max / step) * step;
  const ticks: number[] = [];
  for (let value = min; value <= max + step / 2; value += step) ticks.push(Number(value.toPrecision(12)));
  return { min, max, ticks };
}

/** Value range a chart needs: stacked charts sum positive and negative parts per category. */
export function chartExtent(chart: Pick<ChartElement, 'chartType' | 'categories' | 'series'>): {
  min: number;
  max: number;
} {
  if (chart.chartType === 'stackedBar') {
    let min = 0;
    let max = 0;
    chart.categories.forEach((_, index) => {
      let positive = 0;
      let negative = 0;
      for (const series of chart.series) {
        const value = series.values[index] ?? 0;
        if (value >= 0) positive += value;
        else negative += value;
      }
      max = Math.max(max, positive);
      min = Math.min(min, negative);
    });
    return { min, max };
  }
  const values = chart.series.flatMap((series) => series.values);
  return { min: Math.min(0, ...values), max: Math.max(0, ...values) };
}

/** Compact number for labels: 1250 → "1.25k" in short mode, locale grouping otherwise. */
export function formatChartValue(value: number, locale: string, compact = false): string {
  try {
    return new Intl.NumberFormat(
      locale,
      compact ? { notation: 'compact', maximumFractionDigits: 2 } : { maximumFractionDigits: 2 },
    ).format(value);
  } catch {
    return String(value);
  }
}

export type LegendPosition = 'none' | 'top' | 'bottom' | 'right';

/** Legend default: shown for pies and multi-series charts, hidden for a single series. */
export function chartLegendPosition(
  chart: Pick<ChartElement, 'chartType' | 'series' | 'legend'>,
): LegendPosition {
  if (chart.legend) return chart.legend;
  return chart.chartType === 'pie' || chart.series.length > 1 ? 'bottom' : 'none';
}
