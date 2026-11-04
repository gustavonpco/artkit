import type { Color, LintIssue } from '@artkit-ai/core';
import { type ReactElement, useRef } from 'react';
import { CANVAS, type Rect } from '../geometry.js';
import type { LayoutDefinition, LayoutRegistry, LayoutSlot } from '../layouts.js';
import type { SlidesOperation } from '../operations.js';
import {
  CHART_TYPES,
  type ChartElement,
  type ElementPatch,
  SHAPES,
  type Slide,
  type SlideElement,
  type SlotContent,
  type SlotContentKind,
  type SlotObject,
  slotContentKind,
} from '../schema.js';
import { ColorPicker, NumberField, SelectField, TextField, Toggle } from './controls.js';
import { defaultSlotContent } from './defaults.js';
import { type AlignMode, alignRects, distributeRects } from './geometry.js';
import { ChartGrid, TableGrid } from './grids.js';
import { ItemsEditor } from './ItemsEditor.js';
import type { EditorEnv, Selection, TextTarget } from './types.js';

export interface InspectorProps {
  env: EditorEnv;
  slide: Slide;
  layout: LayoutDefinition;
  layouts: LayoutRegistry;
  selection: Selection;
  onEditText(target: TextTarget): void;
  onSelect(selection: Selection): void;
}

function Issues({ issues }: { issues: LintIssue[] }): ReactElement | null {
  if (issues.length === 0) return null;
  return (
    <ul className="ak-slides-issues" aria-live="polite">
      {issues.map((issue) => (
        <li
          key={`${issue.code}-${issue.target}`}
          className={`ak-slides-issue ak-slides-issue-${issue.severity}`}
          title={issue.hint}
        >
          {issue.message}
        </li>
      ))}
    </ul>
  );
}

const ALIGN_OPTIONS = ['left', 'center', 'right', 'justify'] as const;
const VALIGN_OPTIONS = ['top', 'middle', 'bottom'] as const;

const OPTION_LABELS: Record<string, [string, string]> = {
  none: ['None', 'Nenhuma'],
  left: ['Left', 'Esquerda'],
  center: ['Center', 'Centro'],
  right: ['Right', 'Direita'],
  justify: ['Justify', 'Justificado'],
  top: ['Top', 'Topo'],
  middle: ['Middle', 'Meio'],
  bottom: ['Bottom', 'Base'],
  rect: ['Rectangle', 'Retângulo'],
  roundRect: ['Rounded rectangle', 'Retângulo arredondado'],
  ellipse: ['Ellipse', 'Elipse'],
  line: ['Line', 'Linha'],
  arrow: ['Arrow', 'Seta'],
  bar: ['Bars', 'Barras'],
  column: ['Columns', 'Colunas'],
  pie: ['Pie', 'Pizza'],
  stackedBar: ['Stacked bars', 'Barras empilhadas'],
};

/** Localized label of a fixed option value (alignment, shape, chart type, legend). */
function optionLabel(t: (en: string, pt: string) => string, value: string): string {
  const pair = OPTION_LABELS[value];
  return pair ? t(pair[0], pair[1]) : value;
}

function ImageUploadButton({
  env,
  label,
  onUploaded,
}: {
  env: EditorEnv;
  label: string;
  onUploaded(result: { asset: string; alt?: string }): void;
}): ReactElement | null {
  const input = useRef<HTMLInputElement>(null);
  const upload = env.uploadImage;
  if (!upload) return null;
  return (
    <>
      <button type="button" disabled={env.readOnly} onClick={() => input.current?.click()}>
        {label}
      </button>
      <input
        ref={input}
        type="file"
        accept="image/png,image/jpeg,image/gif,image/webp,image/svg+xml"
        hidden
        onChange={async (event) => {
          const file = event.target.files?.[0];
          event.target.value = '';
          if (file) onUploaded(await upload(file));
        }}
      />
    </>
  );
}

function ElementInspector({
  env,
  element,
  onEditText,
}: {
  env: EditorEnv;
  element: SlideElement;
  onEditText(target: TextTarget): void;
}): ReactElement {
  const { t, ctx, readOnly, allowHexColors } = env;
  const update = (set: ElementPatch) => env.emit([{ op: 'update_element', element: element.id, set }]);
  const isLine = element.type === 'shape' && (element.shape === 'line' || element.shape === 'arrow');
  const minSize = isLine ? 0 : 0.1;
  const color = (label: string, value: Color | undefined, key: keyof ElementPatch, allowNone = false) => (
    <ColorPicker
      label={label}
      value={value}
      theme={ctx.theme}
      locale={ctx.locale}
      allowHex={allowHexColors}
      allowNone={allowNone}
      disabled={readOnly}
      onChange={(next) => update({ [key]: next ?? null } as ElementPatch)}
    />
  );
  const issues = env.lint.filter((issue) => issue.target === `element:${element.id}`);
  return (
    <section className="ak-ctl-section" aria-label={t('Element', 'Elemento')}>
      <h3 className="ak-ctl-section-title">
        {element.type} <code>{element.id}</code>
      </h3>
      <Issues issues={issues} />
      <div className="ak-ctl-row">
        <NumberField
          label="x"
          value={element.x}
          min={0}
          max={CANVAS.width - element.w}
          disabled={readOnly}
          onCommit={(x) => update({ x })}
        />
        <NumberField
          label="y"
          value={element.y}
          min={0}
          max={CANVAS.height - element.h}
          disabled={readOnly}
          onCommit={(y) => update({ y })}
        />
        <NumberField
          label={t('width', 'largura')}
          value={element.w}
          min={minSize}
          max={CANVAS.width - element.x}
          disabled={readOnly}
          onCommit={(w) => update({ w })}
        />
        <NumberField
          label={t('height', 'altura')}
          value={element.h}
          min={minSize}
          max={CANVAS.height - element.y}
          disabled={readOnly}
          onCommit={(h) => update({ h })}
        />
      </div>
      {element.type === 'text' ? (
        <>
          <button
            type="button"
            disabled={readOnly}
            onClick={() => onEditText({ kind: 'element', id: element.id })}
          >
            {t('Edit text', 'Editar texto')}
          </button>
          <div className="ak-ctl-row">
            <NumberField
              label={t('Font size', 'Tamanho')}
              value={element.fontSize ?? 18}
              min={8}
              max={96}
              step={1}
              disabled={readOnly}
              onCommit={(fontSize) => update({ fontSize })}
            />
            <SelectField
              label={t('Font', 'Fonte')}
              value={element.font ?? 'body'}
              options={[
                { value: 'heading', label: t('Heading', 'Título') },
                { value: 'body', label: t('Body', 'Corpo') },
                { value: 'mono', label: t('Monospace', 'Monoespaçada') },
              ]}
              disabled={readOnly}
              onChange={(font) => update({ font })}
            />
          </div>
          <div className="ak-ctl-row">
            <Toggle
              label={t('Bold', 'Negrito')}
              pressed={!!element.bold}
              disabled={readOnly}
              onChange={(bold) => update({ bold: bold || null })}
            >
              B
            </Toggle>
            <Toggle
              label={t('Italic', 'Itálico')}
              pressed={!!element.italic}
              disabled={readOnly}
              onChange={(italic) => update({ italic: italic || null })}
            >
              I
            </Toggle>
            <Toggle
              label={t('Bulleted list', 'Lista com marcadores')}
              pressed={element.bullets !== undefined}
              disabled={readOnly}
              onChange={(on) =>
                update(on ? { bullets: element.paragraphs ?? [] } : { paragraphs: element.bullets ?? [] })
              }
            >
              •
            </Toggle>
            <SelectField
              label={t('Align', 'Alinhar')}
              value={element.align ?? 'left'}
              options={ALIGN_OPTIONS.map((value) => ({ value, label: optionLabel(t, value) }))}
              disabled={readOnly}
              onChange={(align) => update({ align })}
            />
            <SelectField
              label={t('Vertical', 'Vertical')}
              value={element.valign ?? 'top'}
              options={VALIGN_OPTIONS.map((value) => ({ value, label: optionLabel(t, value) }))}
              disabled={readOnly}
              onChange={(valign) => update({ valign })}
            />
          </div>
          {color(t('Text color', 'Cor do texto'), element.color, 'color', true)}
          {color(t('Fill', 'Preenchimento'), element.fill, 'fill', true)}
        </>
      ) : null}
      {element.type === 'shape' ? (
        <>
          <SelectField
            label={t('Shape', 'Forma')}
            value={element.shape}
            options={SHAPES.map((value) => ({ value, label: optionLabel(t, value) }))}
            disabled={readOnly}
            onChange={(shape) => update({ shape })}
          />
          {!isLine ? color(t('Fill', 'Preenchimento'), element.fill, 'fill', true) : null}
          <ColorPicker
            label={t('Line', 'Linha')}
            value={element.line?.color}
            theme={ctx.theme}
            locale={ctx.locale}
            allowHex={allowHexColors}
            allowNone={!isLine}
            disabled={readOnly}
            onChange={(next) => update({ line: next ? { ...element.line, color: next } : null })}
          />
          <div className="ak-ctl-row">
            <NumberField
              label={t('Line width (pt)', 'Espessura (pt)')}
              value={element.line?.width ?? (isLine ? 1.5 : 0)}
              min={0}
              max={20}
              step={0.25}
              disabled={readOnly}
              onCommit={(width) => update({ line: { ...element.line, width } })}
            />
            <SelectField
              label={t('Dash', 'Tracejado')}
              value={element.line?.dash ?? 'solid'}
              options={[
                { value: 'solid', label: t('Solid', 'Contínuo') },
                { value: 'dash', label: t('Dashed', 'Tracejado') },
                { value: 'dot', label: t('Dotted', 'Pontilhado') },
              ]}
              disabled={readOnly}
              onChange={(dash) => update({ line: { ...element.line, dash } })}
            />
          </div>
          {!isLine ? (
            <button
              type="button"
              disabled={readOnly}
              onClick={() => onEditText({ kind: 'element', id: element.id })}
            >
              {element.text ? t('Edit text', 'Editar texto') : t('Add text', 'Adicionar texto')}
            </button>
          ) : (
            <div className="ak-ctl-row">
              <Toggle
                label={t('Flip horizontally', 'Inverter horizontalmente')}
                pressed={!!element.flipH}
                disabled={readOnly}
                onChange={(flipH) => update({ flipH: flipH || null })}
              >
                ⇋
              </Toggle>
              <Toggle
                label={t('Flip vertically', 'Inverter verticalmente')}
                pressed={!!element.flipV}
                disabled={readOnly}
                onChange={(flipV) => update({ flipV: flipV || null })}
              >
                ⇵
              </Toggle>
            </div>
          )}
        </>
      ) : null}
      {element.type === 'image' ? (
        <>
          <TextField
            label={t('Alternative text', 'Texto alternativo')}
            value={element.alt}
            multiline
            disabled={readOnly}
            onCommit={(alt) => update({ alt })}
          />
          <SelectField
            label={t('Fit', 'Ajuste')}
            value={element.fit ?? 'contain'}
            options={[
              { value: 'contain', label: t('Contain', 'Conter') },
              { value: 'cover', label: t('Cover', 'Cobrir') },
            ]}
            disabled={readOnly}
            onChange={(fit) => update({ fit })}
          />
          <ImageUploadButton
            env={env}
            label={t('Replace image', 'Trocar imagem')}
            onUploaded={(result) =>
              update({ asset: result.asset, ...(result.alt ? { alt: result.alt } : {}) })
            }
          />
        </>
      ) : null}
      {element.type === 'table' ? (
        <>
          <TableGrid
            table={element}
            locale={ctx.locale}
            disabled={readOnly}
            onChange={(table) => update({ header: table.header ?? null, rows: table.rows, widths: null })}
          />
          <div className="ak-ctl-row">
            <NumberField
              label={t('Font size', 'Tamanho')}
              value={element.fontSize ?? 14}
              min={8}
              max={96}
              step={1}
              disabled={readOnly}
              onCommit={(fontSize) => update({ fontSize })}
            />
            <Toggle
              label={t('Banded rows', 'Linhas alternadas')}
              pressed={!!element.banded}
              disabled={readOnly}
              onChange={(banded) => update({ banded: banded || null })}
            />
          </div>
          {color(t('Header fill', 'Fundo do cabeçalho'), element.headerFill, 'headerFill', true)}
          {color(t('Header text', 'Texto do cabeçalho'), element.headerColor, 'headerColor', true)}
        </>
      ) : null}
      {element.type === 'chart' ? (
        <ChartFields env={env} chart={element} onChange={(set) => update(set as ElementPatch)} />
      ) : null}
      <fieldset className="ak-ctl-buttons" aria-label={t('Order', 'Ordem')}>
        {(['front', 'forward', 'backward', 'back'] as const).map((to) => (
          <button
            key={to}
            type="button"
            disabled={readOnly}
            onClick={() => env.emit([{ op: 'reorder_element', element: element.id, to }])}
          >
            {
              {
                front: t('Bring to front', 'Trazer para a frente'),
                forward: t('Bring forward', 'Avançar'),
                backward: t('Send backward', 'Recuar'),
                back: t('Send to back', 'Enviar para trás'),
              }[to]
            }
          </button>
        ))}
        <button
          type="button"
          className="ak-ctl-button"
          data-variant="danger"
          disabled={readOnly}
          onClick={() => env.emit([{ op: 'remove_element', element: element.id }])}
        >
          {t('Delete', 'Excluir')}
        </button>
      </fieldset>
    </section>
  );
}

type ChartFieldsValue = Pick<
  ChartElement,
  'chartType' | 'categories' | 'series' | 'showValues' | 'legend' | 'title' | 'fontSize'
>;

function ChartFields({
  env,
  chart,
  onChange,
}: {
  env: EditorEnv;
  chart: ChartFieldsValue;
  onChange(set: Record<string, unknown>): void;
}): ReactElement {
  const { t, ctx, readOnly } = env;
  return (
    <>
      <SelectField
        label={t('Chart type', 'Tipo de gráfico')}
        value={chart.chartType}
        options={CHART_TYPES.map((value) => ({ value, label: optionLabel(t, value) }))}
        disabled={readOnly}
        onChange={(chartType) =>
          onChange(chartType === 'pie' ? { chartType, series: chart.series.slice(0, 1) } : { chartType })
        }
      />
      <ChartGrid
        chart={chart}
        theme={ctx.theme}
        locale={ctx.locale}
        disabled={readOnly}
        onChange={(data) => onChange(data)}
      />
      <div className="ak-ctl-row">
        <Toggle
          label={t('Show values', 'Mostrar valores')}
          pressed={!!chart.showValues}
          disabled={readOnly}
          onChange={(showValues) => onChange({ showValues: showValues || null })}
        />
        <SelectField
          label={t('Legend', 'Legenda')}
          value={chart.legend ?? 'bottom'}
          options={(['none', 'top', 'bottom', 'right'] as const).map((value) => ({
            value,
            label: optionLabel(t, value),
          }))}
          disabled={readOnly}
          onChange={(legend) => onChange({ legend })}
        />
      </div>
      <TextField
        label={t('Chart title', 'Título do gráfico')}
        value={chart.title ?? ''}
        disabled={readOnly}
        onCommit={(title) => onChange({ title: title || null })}
      />
    </>
  );
}

function MultiInspector({ env, elements }: { env: EditorEnv; elements: SlideElement[] }): ReactElement {
  const { t, readOnly } = env;
  const apply = (rects: Rect[]) => {
    const ops: SlidesOperation[] = [];
    elements.forEach((element, index) => {
      const rect = rects[index]!;
      if (rect.x !== element.x || rect.y !== element.y)
        ops.push({ op: 'update_element', element: element.id, set: { x: rect.x, y: rect.y } });
    });
    if (ops.length > 0) env.emit(ops);
  };
  const align = (mode: AlignMode) => apply(alignRects(elements, mode));
  const labels: Record<AlignMode, string> = {
    left: t('Align left', 'Alinhar à esquerda'),
    center: t('Align centers', 'Centralizar'),
    right: t('Align right', 'Alinhar à direita'),
    top: t('Align top', 'Alinhar ao topo'),
    middle: t('Align middles', 'Centralizar verticalmente'),
    bottom: t('Align bottom', 'Alinhar à base'),
  };
  return (
    <section className="ak-ctl-section" aria-label={t('Selection', 'Seleção')}>
      <h3 className="ak-ctl-section-title">
        {t(`${elements.length} elements`, `${elements.length} elementos`)}
      </h3>
      <fieldset className="ak-ctl-buttons" aria-label={t('Align', 'Alinhar')}>
        {(Object.keys(labels) as AlignMode[]).map((mode) => (
          <button key={mode} type="button" disabled={readOnly} onClick={() => align(mode)}>
            {labels[mode]}
          </button>
        ))}
      </fieldset>
      <fieldset className="ak-ctl-buttons" aria-label={t('Distribute', 'Distribuir')}>
        <button
          type="button"
          disabled={readOnly || elements.length < 3}
          onClick={() => apply(distributeRects(elements, 'horizontal'))}
        >
          {t('Distribute horizontally', 'Distribuir na horizontal')}
        </button>
        <button
          type="button"
          disabled={readOnly || elements.length < 3}
          onClick={() => apply(distributeRects(elements, 'vertical'))}
        >
          {t('Distribute vertically', 'Distribuir na vertical')}
        </button>
      </fieldset>
      <button
        type="button"
        className="ak-ctl-button"
        data-variant="danger"
        disabled={readOnly}
        onClick={() => env.emit(elements.map((element) => ({ op: 'remove_element', element: element.id })))}
      >
        {t('Delete selection', 'Excluir seleção')}
      </button>
    </section>
  );
}

function textSlotObject(content: SlotContent): Extract<SlotObject, { type: 'text' | 'bullets' }> | undefined {
  if (typeof content === 'string') return { type: 'text', paragraphs: content.split(/\r?\n/) };
  return content.type === 'text' || content.type === 'bullets' ? content : undefined;
}

function SlotInspector({
  env,
  slide,
  slot,
  onEditText,
}: {
  env: EditorEnv;
  slide: Slide;
  slot: LayoutSlot;
  onEditText(target: TextTarget): void;
}): ReactElement {
  const { t, ctx, readOnly } = env;
  const content = slide.slots[slot.name];
  const set = (next: SlotContent | null) =>
    env.emit([{ op: 'set_slot', slide: slide.id, slot: slot.name, content: next }]);
  const labels = { text: t('Text', 'Texto'), series: t('Series 1', 'Série 1') };
  const kind = content === undefined ? undefined : slotContentKind(content);
  const issues = env.lint.filter((issue) => issue.target === `slot:${slide.id}.${slot.name}`);
  const kindNames: Record<SlotContentKind, string> = {
    text: t('Text', 'Texto'),
    bullets: t('Bullets', 'Marcadores'),
    image: t('Image', 'Imagem'),
    table: t('Table', 'Tabela'),
    chart: t('Chart', 'Gráfico'),
    stats: t('Big numbers', 'Números em destaque'),
    steps: t('Steps', 'Etapas'),
    cards: t('Cards', 'Cartões'),
    quote: t('Quote', 'Citação'),
  };
  const kinds = slot.accepts.filter(
    (accepted) => accepted !== 'image' || env.uploadImage || kind === 'image',
  );
  const textObject = content === undefined ? undefined : textSlotObject(content);
  return (
    <section className="ak-ctl-section" aria-label={t('Slot', 'Slot')}>
      <h3 className="ak-ctl-section-title">
        {t('Slot', 'Slot')} <code>[{slot.name}]</code>
      </h3>
      <Issues issues={issues} />
      {kinds.length > 1 || content === undefined ? (
        <SelectField
          label={t('Content', 'Conteúdo')}
          value={kind}
          options={kinds.map((value) => ({ value, label: kindNames[value] }))}
          disabled={readOnly}
          onChange={(next) => {
            const fresh = defaultSlotContent(next, labels);
            if (fresh !== undefined) set(fresh);
          }}
        />
      ) : null}
      {content === undefined && slot.accepts.includes('image') ? (
        <ImageUploadButton
          env={env}
          label={t('Upload image', 'Enviar imagem')}
          onUploaded={(result) => set({ type: 'image', asset: result.asset, alt: result.alt ?? '' })}
        />
      ) : null}
      {textObject ? (
        <>
          <button
            type="button"
            disabled={readOnly}
            onClick={() => onEditText({ kind: 'slot', slot: slot.name })}
          >
            {t('Edit text', 'Editar texto')}
          </button>
          <div className="ak-ctl-row">
            <NumberField
              label={t('Font size', 'Tamanho')}
              value={textObject.fontSize}
              placeholder={t('Auto', 'Auto')}
              min={8}
              max={96}
              step={1}
              disabled={readOnly}
              onCommit={(fontSize) => set({ ...textObject, fontSize })}
            />
            <SelectField
              label={t('Align', 'Alinhar')}
              value={textObject.align ?? slot.align ?? 'left'}
              options={ALIGN_OPTIONS.map((value) => ({ value, label: optionLabel(t, value) }))}
              disabled={readOnly}
              onChange={(align) => set({ ...textObject, align })}
            />
          </div>
          <ColorPicker
            label={t('Text color', 'Cor do texto')}
            value={textObject.color}
            theme={ctx.theme}
            locale={ctx.locale}
            allowHex={env.allowHexColors}
            allowNone
            disabled={readOnly}
            onChange={(color) => {
              const { color: _old, ...rest } = textObject;
              set(color ? { ...rest, color } : rest);
            }}
          />
        </>
      ) : null}
      {content !== undefined && typeof content === 'object' && content.type === 'table' ? (
        <TableGrid
          table={content}
          locale={ctx.locale}
          disabled={readOnly}
          onChange={(table) => {
            const { header: _h, widths: _w, ...rest } = content;
            set({ ...rest, ...(table.header ? { header: table.header } : {}), rows: table.rows });
          }}
        />
      ) : null}
      {content !== undefined && typeof content === 'object' && content.type === 'chart' ? (
        <ChartFields
          env={env}
          chart={content}
          onChange={(patch) => {
            const next: Record<string, unknown> = { ...content };
            for (const [key, value] of Object.entries(patch)) {
              if (value === null) delete next[key];
              else next[key] = value;
            }
            set(next as SlotContent);
          }}
        />
      ) : null}
      {content !== undefined && typeof content === 'object' && content.type === 'image' ? (
        <>
          <TextField
            label={t('Alternative text', 'Texto alternativo')}
            value={content.alt}
            multiline
            disabled={readOnly}
            onCommit={(alt) => set({ ...content, alt })}
          />
          <TextField
            label={t('Caption', 'Legenda')}
            value={content.caption ?? ''}
            disabled={readOnly}
            onCommit={(caption) => {
              const { caption: _c, ...rest } = content;
              set(caption ? { ...rest, caption } : rest);
            }}
          />
          <SelectField
            label={t('Fit', 'Ajuste')}
            value={content.fit ?? 'contain'}
            options={[
              { value: 'contain', label: t('Contain', 'Conter') },
              { value: 'cover', label: t('Cover', 'Cobrir') },
            ]}
            disabled={readOnly}
            onChange={(fit) => set({ ...content, fit })}
          />
          <ImageUploadButton
            env={env}
            label={t('Replace image', 'Trocar imagem')}
            onUploaded={(result) =>
              set({ ...content, asset: result.asset, ...(result.alt ? { alt: result.alt } : {}) })
            }
          />
        </>
      ) : null}
      {content !== undefined && typeof content === 'object' && content.type === 'quote' ? (
        <>
          <TextField
            label={t('Quote', 'Citação')}
            value={content.text}
            multiline
            disabled={readOnly}
            onCommit={(text) => text && set({ ...content, text })}
          />
          <TextField
            label={t('Attribution', 'Autoria')}
            value={content.attribution ?? ''}
            disabled={readOnly}
            onCommit={(attribution) => {
              const { attribution: _a, ...rest } = content;
              set(attribution ? { ...rest, attribution } : rest);
            }}
          />
        </>
      ) : null}
      {content !== undefined && typeof content === 'object' && content.type === 'stats' ? (
        <ItemsEditor
          items={content.items}
          locale={ctx.locale}
          max={8}
          disabled={readOnly}
          fields={[
            { key: 'value', label: t('Number', 'Número'), required: true },
            { key: 'label', label: t('Label', 'Rótulo'), required: true },
            { key: 'description', label: t('Description', 'Descrição'), multiline: true },
          ]}
          create={() => ({ value: '0', label: '' })}
          itemLabel={(index) => `${t('Number', 'Número')} ${index + 1}`}
          onChange={(items) => items.every((item) => item.value) && set({ ...content, items })}
        />
      ) : null}
      {content !== undefined && typeof content === 'object' && content.type === 'steps' ? (
        <ItemsEditor
          items={content.items}
          locale={ctx.locale}
          max={8}
          disabled={readOnly}
          fields={[
            { key: 'title', label: t('Title', 'Título'), required: true },
            { key: 'description', label: t('Description', 'Descrição'), multiline: true },
            { key: 'marker', label: t('Marker', 'Marcador') },
          ]}
          create={() => ({ title: '' })}
          itemLabel={(index) => `${t('Step', 'Etapa')} ${index + 1}`}
          onChange={(items) => set({ ...content, items })}
        />
      ) : null}
      {content !== undefined && typeof content === 'object' && content.type === 'cards' ? (
        <ItemsEditor
          items={content.items}
          locale={ctx.locale}
          max={9}
          disabled={readOnly}
          fields={[
            { key: 'title', label: t('Title', 'Título') },
            { key: 'value', label: t('Number', 'Número') },
            { key: 'text', label: t('Text', 'Texto'), multiline: true },
            { key: 'bullets', label: t('Bullets (one per line)', 'Marcadores (um por linha)'), list: true },
            { key: 'caption', label: t('Caption', 'Legenda') },
          ]}
          create={() => ({ title: '' })}
          itemLabel={(index) => `${t('Card', 'Cartão')} ${index + 1}`}
          onChange={(items) => set({ ...content, items })}
        />
      ) : null}
      {content !== undefined ? (
        <button
          type="button"
          className="ak-ctl-button"
          data-variant="danger"
          disabled={readOnly}
          onClick={() => set(null)}
        >
          {t('Clear slot', 'Limpar slot')}
        </button>
      ) : null}
    </section>
  );
}

function SlideInspector({
  env,
  slide,
  layout,
  layouts,
  onSelect,
}: {
  env: EditorEnv;
  slide: Slide;
  layout: LayoutDefinition;
  layouts: LayoutRegistry;
  onSelect(selection: Selection): void;
}): ReactElement {
  const { t, ctx, readOnly } = env;
  const issues = env.lint.filter((issue) => issue.target === `slide:${slide.id}`);
  return (
    <section className="ak-ctl-section" aria-label={t('Slide', 'Slide')}>
      <h3 className="ak-ctl-section-title">
        {t('Slide', 'Slide')} <code>{slide.id}</code>
      </h3>
      <Issues issues={issues} />
      <SelectField
        label={t('Layout', 'Layout')}
        value={layout.name}
        options={layouts.list().map((item) => ({ value: item.name, label: item.label }))}
        disabled={readOnly}
        onChange={(name) => env.emit([{ op: 'set_layout', slide: slide.id, layout: name }])}
      />
      {layout.slots.length > 0 ? (
        <ul className="ak-ctl-list">
          {layout.slots.map((slot) => (
            <li key={slot.name}>
              <button
                type="button"
                className="ak-ctl-list-item"
                onClick={() => onSelect({ kind: 'slot', slot: slot.name })}
              >
                [{slot.name}]{' '}
                {slide.slots[slot.name] === undefined
                  ? t('(empty)', '(vazio)')
                  : slotContentKind(slide.slots[slot.name]!)}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      <ColorPicker
        label={t('Background', 'Fundo')}
        value={slide.background?.color}
        theme={ctx.theme}
        locale={ctx.locale}
        allowHex={env.allowHexColors}
        allowNone
        disabled={readOnly}
        onChange={(color) => {
          const image = slide.background?.image;
          const next = { ...(color ? { color } : {}), ...(image ? { image } : {}) };
          env.emit([
            { op: 'set_background', slide: slide.id, background: Object.keys(next).length > 0 ? next : null },
          ]);
        }}
      />
      <div className="ak-ctl-buttons">
        <ImageUploadButton
          env={env}
          label={t('Background image', 'Imagem de fundo')}
          onUploaded={(result) =>
            env.emit([
              {
                op: 'set_background',
                slide: slide.id,
                background: { ...slide.background, image: result.asset },
              },
            ])
          }
        />
        {slide.background?.image ? (
          <button
            type="button"
            disabled={readOnly}
            onClick={() =>
              env.emit([
                {
                  op: 'set_background',
                  slide: slide.id,
                  background: slide.background?.color ? { color: slide.background.color } : null,
                },
              ])
            }
          >
            {t('Remove background image', 'Remover imagem de fundo')}
          </button>
        ) : null}
        <Toggle
          label={t('Hidden in presentation', 'Oculto na apresentação')}
          pressed={!!slide.hidden}
          disabled={readOnly}
          onChange={(hidden) => env.emit([{ op: 'set_hidden', slide: slide.id, hidden }])}
        />
      </div>
    </section>
  );
}

/** Properties panel: slide, slot, single element or multi-selection. */
export function Inspector({
  env,
  slide,
  layout,
  layouts,
  selection,
  onEditText,
  onSelect,
}: InspectorProps): ReactElement {
  if (selection.kind === 'elements') {
    const elements = selection.ids
      .map((id) => slide.elements.find((element) => element.id === id))
      .filter((element): element is SlideElement => !!element);
    if (elements.length === 1)
      return <ElementInspector env={env} element={elements[0]!} onEditText={onEditText} />;
    if (elements.length > 1) return <MultiInspector env={env} elements={elements} />;
  }
  if (selection.kind === 'slot') {
    const slot = layout.slots.find((candidate) => candidate.name === selection.slot);
    if (slot) return <SlotInspector env={env} slide={slide} slot={slot} onEditText={onEditText} />;
  }
  return <SlideInspector env={env} slide={slide} layout={layout} layouts={layouts} onSelect={onSelect} />;
}
