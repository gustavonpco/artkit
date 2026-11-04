import { type Color, isSafeLink, type RenderContext } from '@artkit/core';
import { type CSSProperties, type ReactElement, type ReactNode, useId } from 'react';
import {
  DEFAULT_SHAPE_TEXT_STYLE,
  type Primitive,
  type ResolvedTextStyle,
  resolveTextStyle,
} from '../compose.js';
import { tableColumnWidths, textElementParagraphs } from '../elements.js';
import { CANVAS, cqw, pctX, pctY, type Rect } from '../geometry.js';
import { isTitleRole } from '../layouts.js';
import type { ImageElement, Run, ShapeElement, TableElement } from '../schema.js';
import { listOrdinals, type NormalizedParagraph, normalizeParagraphs } from '../text.js';
import { TEXT_BOX } from '../text-metrics.js';
import { ChartSvg } from './ChartSvg.js';
import { colorCss, fontCss } from './style.js';

export function boxStyle(rect: Rect): CSSProperties {
  return { left: pctX(rect.x), top: pctY(rect.y), width: pctX(rect.w), height: pctY(rect.h) };
}

const VALIGN: Record<ResolvedTextStyle['valign'], CSSProperties['justifyContent']> = {
  top: 'flex-start',
  middle: 'center',
  bottom: 'flex-end',
};

function RunView({ run, ctx }: { run: Run; ctx: RenderContext }): ReactNode {
  const style: CSSProperties = {};
  if (run.bold) style.fontWeight = 700;
  if (run.italic) style.fontStyle = 'italic';
  if (run.underline) style.textDecoration = 'underline';
  if (run.color) style.color = colorCss(ctx.theme, run.color);
  const hasStyle = Object.keys(style).length > 0;
  if (run.link && isSafeLink(run.link)) {
    const external = /^https?:/i.test(run.link);
    return (
      <a
        href={run.link}
        style={style}
        {...(external ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
      >
        {run.text}
      </a>
    );
  }
  return hasStyle ? <span style={style}>{run.text}</span> : run.text;
}

function Runs({ runs, ctx }: { runs: Run[]; ctx: RenderContext }): ReactNode {
  // biome-ignore lint/suspicious/noArrayIndexKey: positional cells/runs have no identity and never reorder
  const content = runs.map((run, index) => <RunView key={index} run={run} ctx={ctx} />);
  // An empty paragraph still takes one line, as in PowerPoint.
  return runs.every((run) => run.text === '') ? '\u00A0' : content;
}

/** Renders paragraphs, grouping consecutive list items into <ul>/<ol> with per-level indentation. */
export function ParagraphsView({
  paragraphs,
  ctx,
  inline,
}: {
  paragraphs: NormalizedParagraph[];
  ctx: RenderContext;
  inline?: boolean;
}): ReactElement {
  const ordinals = listOrdinals(paragraphs);
  const blocks: ReactNode[] = [];
  let index = 0;
  while (index < paragraphs.length) {
    const paragraph = paragraphs[index]!;
    if (!paragraph.list || inline) {
      const Tag = inline ? 'span' : 'p';
      blocks.push(
        <Tag key={index} className="ak-slides-p">
          <Runs runs={paragraph.runs} ctx={ctx} />
        </Tag>,
      );
      index++;
      continue;
    }
    const kind = paragraph.list;
    const items: ReactNode[] = [];
    const start = index;
    while (index < paragraphs.length && paragraphs[index]!.list === kind) {
      const item = paragraphs[index]!;
      items.push(
        <li
          key={index}
          className="ak-slides-li"
          value={kind === 'number' ? ordinals[index] : undefined}
          style={{ marginLeft: cqw(TEXT_BOX.bulletIndentPt * (item.level + 1)) }}
          data-level={item.level}
        >
          <Runs runs={item.runs} ctx={ctx} />
        </li>,
      );
      index++;
    }
    blocks.push(
      kind === 'number' ? (
        <ol key={`l${start}`} className="ak-slides-list">
          {items}
        </ol>
      ) : (
        <ul key={`l${start}`} className="ak-slides-list">
          {items}
        </ul>
      ),
    );
  }
  return <>{blocks}</>;
}

export function textBoxStyle(ctx: RenderContext, style: ResolvedTextStyle, fill?: Color): CSSProperties {
  return {
    fontSize: cqw(style.fontSize),
    fontFamily: fontCss(ctx.theme, style.font),
    fontWeight: style.bold ? 700 : 400,
    fontStyle: style.italic ? 'italic' : 'normal',
    color: colorCss(ctx.theme, style.color),
    textAlign: style.align,
    justifyContent: VALIGN[style.valign],
    padding: `${cqw(TEXT_BOX.padY * 72)} ${cqw(TEXT_BOX.padX * 72)}`,
    lineHeight: TEXT_BOX.lineHeight,
    ...(fill ? { background: colorCss(ctx.theme, fill) } : {}),
  };
}

function lineStroke(
  ctx: RenderContext,
  shape: ShapeElement,
): { color: string; width: number; dash?: string } | undefined {
  const isLine = shape.shape === 'line' || shape.shape === 'arrow';
  if (!shape.line && !isLine) return undefined;
  const width = shape.line?.width ?? (isLine ? 1.5 : 1);
  if (width <= 0) return undefined;
  const color = colorCss(ctx.theme, shape.line?.color ?? (isLine ? 'text' : 'muted'));
  const dash = shape.line?.dash === 'dash' ? 'dashed' : shape.line?.dash === 'dot' ? 'dotted' : undefined;
  return { color, width, ...(dash ? { dash } : {}) };
}

/** Lines and arrows draw in a slide-sized SVG (at their own stacking position) so strokes scale exactly. */
function LineView({ element, ctx }: { element: ShapeElement; ctx: RenderContext }): ReactElement {
  const stroke = lineStroke(ctx, element)!;
  const W = CANVAS.width * 72;
  const H = CANVAS.height * 72;
  const x1 = (element.flipH ? element.x + element.w : element.x) * 72;
  const x2 = (element.flipH ? element.x : element.x + element.w) * 72;
  const y1 = (element.flipV ? element.y + element.h : element.y) * 72;
  const y2 = (element.flipV ? element.y : element.y + element.h) * 72;
  // Unique per render: the same slide can be on screen twice (thumbnail and main view).
  const markerId = `ak-arrow-${useId().replace(/[^A-Za-z0-9_-]/g, '')}`;
  const dash =
    stroke.dash === 'dashed'
      ? `${stroke.width * 4} ${stroke.width * 3}`
      : stroke.dash === 'dotted'
        ? `${stroke.width} ${stroke.width * 2}`
        : undefined;
  return (
    <svg
      className="ak-slides-line"
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="none"
      aria-hidden="true"
      data-element-id={element.id}
    >
      {element.shape === 'arrow' ? (
        <defs>
          <marker
            id={markerId}
            viewBox="0 0 10 10"
            refX="8"
            refY="5"
            markerWidth="5"
            markerHeight="5"
            orient="auto-start-reverse"
          >
            <path d="M 0 0 L 10 5 L 0 10 z" fill={stroke.color} />
          </marker>
        </defs>
      ) : null}
      <line
        x1={x1}
        y1={y1}
        x2={x2}
        y2={y2}
        stroke={stroke.color}
        strokeWidth={stroke.width}
        strokeDasharray={dash}
        markerEnd={element.shape === 'arrow' ? `url(#${markerId})` : undefined}
      />
    </svg>
  );
}

function ShapeView({ element, ctx }: { element: ShapeElement; ctx: RenderContext }): ReactElement {
  const stroke = lineStroke(ctx, element);
  const radius =
    element.shape === 'ellipse'
      ? '50%'
      : element.shape === 'roundRect'
        ? cqw(Math.min(element.w, element.h) * 72 * 0.1667)
        : undefined;
  const text = element.text;
  const style: CSSProperties = {
    ...boxStyle(element),
    ...(element.fill ? { background: colorCss(ctx.theme, element.fill) } : {}),
    ...(stroke ? { border: `${cqw(stroke.width)} ${stroke.dash ?? 'solid'} ${stroke.color}` } : {}),
    ...(radius ? { borderRadius: radius } : {}),
    ...(text ? textBoxStyle(ctx, resolveTextStyle(text, DEFAULT_SHAPE_TEXT_STYLE)) : {}),
  };
  return (
    <div className="ak-slides-el ak-slides-shape" style={style} data-element-id={element.id}>
      {text ? <ParagraphsView paragraphs={normalizeParagraphs(text.paragraphs)} ctx={ctx} /> : null}
    </div>
  );
}

function ImageView({ element, ctx }: { element: ImageElement; ctx: RenderContext }): ReactElement {
  const url = ctx.resolveAssetUrl?.(element.asset);
  if (!url) {
    return (
      <div
        className="ak-slides-el ak-slides-image ak-slides-image-missing"
        style={boxStyle(element)}
        role="img"
        aria-label={element.alt}
        data-element-id={element.id}
      >
        <span>{element.alt || element.asset}</span>
      </div>
    );
  }
  return (
    <div className="ak-slides-el ak-slides-image" style={boxStyle(element)} data-element-id={element.id}>
      <img src={url} alt={element.alt} style={{ objectFit: element.fit ?? 'contain' }} draggable={false} />
    </div>
  );
}

export function TableView({ element, ctx }: { element: TableElement; ctx: RenderContext }): ReactElement {
  const widths = tableColumnWidths(element, element.w);
  const fontSize = element.fontSize ?? 14;
  const border = colorCss(ctx.theme, element.borderColor ?? 'muted');
  const headerFill = colorCss(ctx.theme, element.headerFill ?? 'text');
  const headerColor = colorCss(ctx.theme, element.headerColor ?? 'background');
  const cellStyle: CSSProperties = { borderColor: border, padding: `${cqw(0.05 * 72)} ${cqw(0.08 * 72)}` };
  return (
    <div className="ak-slides-el ak-slides-table" style={boxStyle(element)} data-element-id={element.id}>
      <table
        style={{
          fontSize: cqw(fontSize),
          color: colorCss(ctx.theme, element.color ?? 'text'),
          fontFamily: fontCss(ctx.theme, 'body'),
        }}
      >
        <colgroup>
          {widths.map((width, index) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: positional cells/runs have no identity and never reorder
            <col key={index} style={{ width: `${(width / element.w) * 100}%` }} />
          ))}
        </colgroup>
        {element.header ? (
          <thead>
            <tr>
              {element.header.map((cell, index) => (
                <th
                  // biome-ignore lint/suspicious/noArrayIndexKey: positional cells/runs have no identity and never reorder
                  key={index}
                  scope="col"
                  style={{ ...cellStyle, background: headerFill, color: headerColor }}
                >
                  {cell}
                </th>
              ))}
            </tr>
          </thead>
        ) : null}
        <tbody>
          {element.rows.map((row, rowIndex) => (
            <tr
              // biome-ignore lint/suspicious/noArrayIndexKey: positional cells/runs have no identity and never reorder
              key={rowIndex}
              className={element.banded && rowIndex % 2 === 1 ? 'ak-slides-band' : undefined}
            >
              {row.map((cell, index) => (
                <td
                  // biome-ignore lint/suspicious/noArrayIndexKey: positional cells/runs have no identity and never reorder
                  key={index}
                  style={{
                    ...cellStyle,
                    ...(element.banded && rowIndex % 2 === 1
                      ? { background: colorCss(ctx.theme, 'surface') }
                      : {}),
                  }}
                >
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** One primitive (slot content, decoration, footer or free element) positioned in percent of the slide. */
export function PrimitiveView({
  primitive,
  ctx,
}: {
  primitive: Primitive;
  ctx: RenderContext;
}): ReactElement | null {
  const { element } = primitive;
  switch (element.type) {
    case 'text': {
      const style = resolveTextStyle(element);
      const heading = primitive.role !== undefined && isTitleRole(primitive.role);
      const Tag = heading ? 'h2' : 'div';
      return (
        <Tag
          className={`ak-slides-el ak-slides-text${heading ? ' ak-slides-heading' : ''}`}
          style={{ ...boxStyle(element), ...textBoxStyle(ctx, style, element.fill) }}
          data-element-id={primitive.source.kind === 'element' ? element.id : undefined}
          data-slot={primitive.source.kind === 'slot' ? primitive.source.slot : undefined}
        >
          <ParagraphsView paragraphs={textElementParagraphs(element)} ctx={ctx} inline={heading} />
        </Tag>
      );
    }
    case 'shape':
      if (element.shape === 'line' || element.shape === 'arrow')
        return <LineView element={element} ctx={ctx} />;
      return <ShapeView element={element} ctx={ctx} />;
    case 'image':
      return <ImageView element={element} ctx={ctx} />;
    case 'table':
      return <TableView element={element} ctx={ctx} />;
    case 'chart':
      return (
        <div
          className="ak-slides-el ak-slides-chart-box"
          style={boxStyle(element)}
          data-element-id={element.id}
        >
          <ChartSvg
            chart={element}
            width={element.w}
            height={element.h}
            theme={ctx.theme}
            locale={ctx.locale}
          />
        </div>
      );
  }
}
