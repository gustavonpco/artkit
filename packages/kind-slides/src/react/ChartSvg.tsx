import type { Theme } from '@artkit/core';
import { createElement, type ReactElement } from 'react';

// Chart marks are positional (one per category/series) and never reorder, so they are passed to
// createElement as static children instead of keyed lists.
function group(className: string | undefined, children: ReactElement[]): ReactElement {
  return createElement('g', className ? { className } : null, ...children);
}

import { chartExtent, chartLegendPosition, formatChartValue, niceScale } from '../chart-scale.js';
import type { ChartElement } from '../schema.js';
import { colorCss, fontCss, paletteColor } from './style.js';

export type ChartData = Pick<
  ChartElement,
  'chartType' | 'categories' | 'series' | 'showValues' | 'legend' | 'title' | 'fontSize'
>;

export interface ChartSvgProps {
  chart: ChartData;
  /** Size in inches; the SVG works in points so text scales with the slide. */
  width: number;
  height: number;
  theme: Theme;
  locale: string;
  className?: string;
}

const CHAR = 0.55;

function textWidth(text: string, size: number): number {
  return text.length * size * CHAR;
}

function seriesColor(chart: ChartData, theme: Theme, index: number): string {
  const color = chart.series[index]?.color;
  return color ? colorCss(theme, color) : paletteColor(theme, index);
}

interface LegendEntry {
  label: string;
  color: string;
}

function legendItem(entry: LegendEntry, x: number, y: number, swatch: number, size: number): ReactElement {
  return (
    <g transform={`translate(${x}, ${y})`}>
      <rect width={swatch} height={swatch} fill={entry.color} y={-swatch / 2} />
      <text x={swatch + size * 0.4} dominantBaseline="central" fontSize={size}>
        {entry.label}
      </text>
    </g>
  );
}

function Legend({
  entries,
  x,
  y,
  width,
  size,
  vertical,
}: {
  entries: LegendEntry[];
  x: number;
  y: number;
  width: number;
  size: number;
  vertical: boolean;
}) {
  const swatch = size * 0.8;
  const gap = size * 1.2;
  if (vertical) {
    const items: ReactElement[] = [];
    entries.forEach((entry, index) => {
      items.push(legendItem(entry, x, y + index * size * 1.6, swatch, size));
    });
    return group('ak-slides-chart-legend', items);
  }
  const widths = entries.map((entry) => swatch + size * 0.4 + textWidth(entry.label, size));
  const total = widths.reduce((sum, w) => sum + w, 0) + gap * Math.max(0, entries.length - 1);
  let cursor = x + Math.max(0, (width - total) / 2);
  const items: ReactElement[] = [];
  entries.forEach((entry, index) => {
    items.push(legendItem(entry, cursor, y, swatch, size));
    cursor += (widths[index] ?? 0) + gap;
  });
  return group('ak-slides-chart-legend', items);
}

function describe(chart: ChartData): string {
  const series = chart.series
    .map(
      (s) =>
        `${s.name}: ${chart.categories.map((category, index) => `${category} ${s.values[index] ?? ''}`).join(', ')}`,
    )
    .join('; ');
  return `${chart.title ? `${chart.title}. ` : ''}${chart.chartType} chart. ${series}`;
}

/** Inline SVG chart (bar, column, line, pie, stackedBar) using the theme chart palette. */
export function ChartSvg({ chart, width, height, theme, locale, className }: ChartSvgProps): ReactElement {
  const W = Math.max(1, width * 72);
  const H = Math.max(1, height * 72);
  const size = chart.fontSize ?? 12;
  const pad = size * 0.5;
  const legend = chartLegendPosition(chart);
  const textColor = colorCss(theme, 'text');
  const mutedColor = colorCss(theme, 'muted');
  const isPie = chart.chartType === 'pie';
  const entries: LegendEntry[] = isPie
    ? chart.categories.map((label, index) => ({ label, color: paletteColor(theme, index) }))
    : chart.series.map((series, index) => ({ label: series.name, color: seriesColor(chart, theme, index) }));

  let top = pad;
  let bottom = H - pad;
  let right = W - pad;
  const left = pad;
  const parts: ReactElement[] = [];
  if (chart.title) {
    parts.push(
      <text
        x={W / 2}
        y={top + size * 0.9}
        textAnchor="middle"
        fontSize={size * 1.25}
        fontWeight={700}
        fill={textColor}
      >
        {chart.title}
      </text>,
    );
    top += size * 1.9;
  }
  if (legend === 'bottom') {
    parts.push(
      <Legend
        entries={entries}
        x={left}
        y={bottom - size * 0.6}
        width={right - left}
        size={size}
        vertical={false}
      />,
    );
    bottom -= size * 1.8;
  } else if (legend === 'top') {
    parts.push(
      <Legend
        entries={entries}
        x={left}
        y={top + size * 0.6}
        width={right - left}
        size={size}
        vertical={false}
      />,
    );
    top += size * 1.8;
  } else if (legend === 'right') {
    const legendWidth = Math.min(
      (right - left) * 0.4,
      size * 2 + Math.max(...entries.map((entry) => textWidth(entry.label, size))),
    );
    parts.push(
      <Legend
        entries={entries}
        x={right - legendWidth}
        y={(top + bottom) / 2 - ((entries.length - 1) * size * 1.6) / 2}
        width={legendWidth}
        size={size}
        vertical
      />,
    );
    right -= legendWidth + pad;
  }
  const plotW = Math.max(1, right - left);
  const plotH = Math.max(1, bottom - top);

  if (isPie) {
    const values = chart.series[0]?.values ?? [];
    const total = values.reduce((sum, value) => sum + Math.max(0, value), 0) || 1;
    const radius = Math.max(1, Math.min(plotW, plotH) / 2);
    const cx = left + plotW / 2;
    const cy = top + plotH / 2;
    let angle = -Math.PI / 2;
    values.forEach((raw, index) => {
      const value = Math.max(0, raw);
      const sweep = (value / total) * Math.PI * 2;
      const start = angle;
      const end = angle + sweep;
      angle = end;
      if (value <= 0) return;
      const color = paletteColor(theme, index);
      if (sweep >= Math.PI * 2 - 1e-9) {
        parts.push(<circle cx={cx} cy={cy} r={radius} fill={color} />);
      } else {
        const x1 = cx + radius * Math.cos(start);
        const y1 = cy + radius * Math.sin(start);
        const x2 = cx + radius * Math.cos(end);
        const y2 = cy + radius * Math.sin(end);
        const large = sweep > Math.PI ? 1 : 0;
        parts.push(
          <path
            d={`M ${cx} ${cy} L ${x1} ${y1} A ${radius} ${radius} 0 ${large} 1 ${x2} ${y2} Z`}
            fill={color}
            stroke="#FFFFFF"
            strokeWidth={1}
          />,
        );
      }
      if (chart.showValues) {
        const mid = start + sweep / 2;
        parts.push(
          <text
            x={cx + radius * 0.65 * Math.cos(mid)}
            y={cy + radius * 0.65 * Math.sin(mid)}
            textAnchor="middle"
            dominantBaseline="central"
            fontSize={size}
            fill="#FFFFFF"
            fontWeight={700}
          >
            {formatChartValue(raw, locale)}
          </text>,
        );
      }
    });
  } else {
    const horizontal = chart.chartType === 'bar' || chart.chartType === 'stackedBar';
    const stacked = chart.chartType === 'stackedBar';
    const extent = chartExtent(chart);
    const scale = niceScale(extent.min, extent.max);
    const tickLabels = scale.ticks.map((tick) => formatChartValue(tick, locale, true));
    const categoryLabelWidth = horizontal
      ? Math.min(plotW * 0.35, Math.max(...chart.categories.map((c) => textWidth(c, size))) + pad)
      : 0;
    const valueLabelWidth = horizontal
      ? 0
      : Math.max(...tickLabels.map((label) => textWidth(label, size))) + pad;
    const axisBand = size * 1.6;
    const area = {
      x: left + (horizontal ? categoryLabelWidth : valueLabelWidth),
      y: top + (chart.showValues && !horizontal ? size : 0),
      w: 0,
      h: 0,
    };
    area.w = Math.max(1, right - area.x - (horizontal && chart.showValues ? size * 2.5 : 0));
    area.h = Math.max(1, bottom - axisBand - area.y);
    const span = scale.max - scale.min || 1;
    const valuePos = (value: number) =>
      horizontal
        ? area.x + ((value - scale.min) / span) * area.w
        : area.y + area.h - ((value - scale.min) / span) * area.h;
    const zero = valuePos(0);
    // Gridlines and value-axis labels.
    scale.ticks.forEach((tick, index) => {
      const p = valuePos(tick);
      parts.push(
        horizontal ? (
          <g>
            <line
              x1={p}
              x2={p}
              y1={area.y}
              y2={area.y + area.h}
              stroke={mutedColor}
              strokeOpacity={0.25}
              strokeWidth={0.75}
            />
            <text
              x={p}
              y={area.y + area.h + size * 1.1}
              textAnchor="middle"
              fontSize={size}
              fill={mutedColor}
            >
              {tickLabels[index]}
            </text>
          </g>
        ) : (
          <g>
            <line
              x1={area.x}
              x2={area.x + area.w}
              y1={p}
              y2={p}
              stroke={mutedColor}
              strokeOpacity={0.25}
              strokeWidth={0.75}
            />
            <text
              x={area.x - pad / 2}
              y={p}
              textAnchor="end"
              dominantBaseline="central"
              fontSize={size}
              fill={mutedColor}
            >
              {tickLabels[index]}
            </text>
          </g>
        ),
      );
    });
    const count = chart.categories.length;
    const band = (horizontal ? area.h : area.w) / Math.max(1, count);
    chart.categories.forEach((category, index) => {
      const center = (horizontal ? area.y : area.x) + band * (index + 0.5);
      parts.push(
        horizontal ? (
          <text
            x={area.x - pad / 2}
            y={center}
            textAnchor="end"
            dominantBaseline="central"
            fontSize={size}
            fill={textColor}
          >
            {category}
          </text>
        ) : (
          <text
            x={center}
            y={area.y + area.h + size * 1.1}
            textAnchor="middle"
            fontSize={size}
            fill={textColor}
          >
            {category}
          </text>
        ),
      );
    });
    if (chart.chartType === 'line') {
      chart.series.forEach((series, s) => {
        const color = seriesColor(chart, theme, s);
        const points = series.values.map(
          (value, index) => [area.x + band * (index + 0.5), valuePos(value)] as const,
        );
        parts.push(
          <polyline
            points={points.map(([x, y]) => `${x},${y}`).join(' ')}
            fill="none"
            stroke={color}
            strokeWidth={2.25}
            strokeLinejoin="round"
          />,
        );
        points.forEach(([x, y], index) => {
          parts.push(<circle cx={x} cy={y} r={3} fill={color} />);
          if (chart.showValues) {
            parts.push(
              <text x={x} y={y - size * 0.6} textAnchor="middle" fontSize={size * 0.9} fill={textColor}>
                {formatChartValue(series.values[index] ?? 0, locale)}
              </text>,
            );
          }
        });
      });
    } else {
      const groups = stacked ? 1 : Math.max(1, chart.series.length);
      const thickness = (band * 0.7) / groups;
      chart.categories.forEach((_, index) => {
        let positive = 0;
        let negative = 0;
        chart.series.forEach((series, s) => {
          const value = series.values[index] ?? 0;
          let from = 0;
          let to = value;
          if (stacked) {
            from = value >= 0 ? positive : negative;
            to = from + value;
            if (value >= 0) positive = to;
            else negative = to;
          }
          const a = valuePos(from);
          const b = valuePos(to);
          const offset =
            (horizontal ? area.y : area.x) + band * index + band * 0.15 + (stacked ? 0 : thickness * s);
          const color = seriesColor(chart, theme, s);
          const rect = horizontal
            ? { x: Math.min(a, b), y: offset, width: Math.abs(b - a), height: thickness }
            : { x: offset, y: Math.min(a, b), width: thickness, height: Math.abs(b - a) };
          parts.push(<rect {...rect} fill={color} />);
          if (chart.showValues) {
            const label = formatChartValue(value, locale);
            parts.push(
              horizontal ? (
                <text
                  x={stacked ? (a + b) / 2 : b + (value >= 0 ? pad / 2 : -pad / 2)}
                  y={offset + thickness / 2}
                  textAnchor={stacked ? 'middle' : value >= 0 ? 'start' : 'end'}
                  dominantBaseline="central"
                  fontSize={size * 0.9}
                  fill={stacked ? '#FFFFFF' : textColor}
                >
                  {label}
                </text>
              ) : (
                <text
                  x={offset + thickness / 2}
                  y={value >= 0 ? b - size * 0.35 : b + size}
                  textAnchor="middle"
                  fontSize={size * 0.9}
                  fill={textColor}
                >
                  {label}
                </text>
              ),
            );
          }
        });
      });
    }
    parts.push(
      horizontal ? (
        <line x1={zero} x2={zero} y1={area.y} y2={area.y + area.h} stroke={mutedColor} strokeWidth={1} />
      ) : (
        <line x1={area.x} x2={area.x + area.w} y1={zero} y2={zero} stroke={mutedColor} strokeWidth={1} />
      ),
    );
  }

  return (
    <svg
      className={className ?? 'ak-slides-chart'}
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="xMidYMid meet"
      role="img"
      aria-label={describe(chart)}
      fontFamily={fontCss(theme, 'body')}
      fill={textColor}
    >
      <title>{describe(chart)}</title>
      {group(undefined, parts)}
    </svg>
  );
}
