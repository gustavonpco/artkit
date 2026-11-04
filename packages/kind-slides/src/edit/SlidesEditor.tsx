import { type EditorBindings, IdAllocator } from '@artkit/core';
import {
  Toolbar,
  ToolbarButton,
  ToolbarColor,
  ToolbarGroup,
  ToolbarMenu,
  ToolbarSelect,
  themeSwatches,
} from '@artkit/react';
import {
  AlignCenterHorizontal,
  AlignCenterVertical,
  AlignEndHorizontal,
  AlignEndVertical,
  AlignHorizontalJustifyCenter,
  AlignHorizontalSpaceAround,
  AlignStartHorizontal,
  AlignStartVertical,
  AlignVerticalSpaceAround,
  ArrowDownToLine,
  ArrowRight,
  ArrowUpToLine,
  BringToFront,
  ChartBar,
  ChartColumn,
  ChartColumnStacked,
  ChartLine,
  ChartPie,
  Circle,
  ClipboardPaste,
  Copy,
  CopyPlus,
  Grid3x3,
  Image as ImageIcon,
  Layers,
  LayoutTemplate,
  type LucideIcon,
  Minus,
  PaintBucket,
  Plus,
  Presentation,
  RectangleHorizontal,
  Scissors,
  SendToBack,
  Shapes,
  Square,
  Table,
  Trash2,
  Type,
} from 'lucide-react';
import { type ReactElement, useEffect, useMemo, useRef, useState } from 'react';
import { tr } from '../i18n.js';
import { builtInLayouts, type LayoutRegistry, resolveLayout } from '../layouts.js';
import { ELEMENT_ID_PREFIX, type SlidesOperation } from '../operations.js';
import { SlidesPresentation } from '../react/Presentation.js';
import type { CHART_TYPES, ElementInput, SlidesContent } from '../schema.js';
import {
  alignOps,
  cloneElementsOps,
  deleteOps,
  distributeOps,
  duplicateOps,
  parseClipboard,
  type ReorderTarget,
  reorderOps,
  serializeElements,
} from './actions.js';
import { TextField, Toggle } from './controls.js';
import { type InsertKind, newElement, newImageElement } from './defaults.js';
import { EditCanvas } from './EditCanvas.js';
import type { AlignMode } from './geometry.js';
import { Inspector } from './Inspector.js';
import { SlidePanel } from './SlidePanel.js';
import type { EditorEnv, Selection, TextTarget, UploadImage } from './types.js';

export interface SlidesEditorProps extends EditorBindings<SlidesContent, SlidesOperation> {
  /** Layouts of the kind (`slidesKind.layouts`); defaults to the built-ins. */
  layouts?: LayoutRegistry;
  /** Stores an image through the host's AssetStore; enables image insertion and replacement. */
  uploadImage?: UploadImage;
  /** Offer hex colors besides theme tokens (default false). */
  allowHexColors?: boolean;
  /** Snapping grid step in inches when the grid is on (default 0.25). */
  gridSize?: number;
  initialSlideId?: string;
  className?: string;
}

const SHAPES: [InsertKind, LucideIcon, string, string][] = [
  ['rect', Square, 'Rectangle', 'Retângulo'],
  ['roundRect', RectangleHorizontal, 'Rounded rectangle', 'Retângulo arredondado'],
  ['ellipse', Circle, 'Ellipse', 'Elipse'],
  ['line', Minus, 'Line', 'Linha'],
  ['arrow', ArrowRight, 'Arrow', 'Seta'],
];

const CHARTS: [(typeof CHART_TYPES)[number], LucideIcon, string, string][] = [
  ['column', ChartColumn, 'Column chart', 'Gráfico de colunas'],
  ['bar', ChartBar, 'Bar chart', 'Gráfico de barras'],
  ['stackedBar', ChartColumnStacked, 'Stacked bar chart', 'Barras empilhadas'],
  ['line', ChartLine, 'Line chart', 'Gráfico de linhas'],
  ['pie', ChartPie, 'Pie chart', 'Gráfico de pizza'],
];

const ALIGNS: [AlignMode, LucideIcon, string, string][] = [
  ['left', AlignStartVertical, 'Align left', 'Alinhar à esquerda'],
  ['center', AlignCenterVertical, 'Align centers', 'Centralizar na horizontal'],
  ['right', AlignEndVertical, 'Align right', 'Alinhar à direita'],
  ['top', AlignStartHorizontal, 'Align top', 'Alinhar ao topo'],
  ['middle', AlignCenterHorizontal, 'Align middles', 'Centralizar na vertical'],
  ['bottom', AlignEndHorizontal, 'Align bottom', 'Alinhar à base'],
];

const ORDERS: [ReorderTarget, LucideIcon, string, string][] = [
  ['front', BringToFront, 'Bring to front', 'Trazer para a frente'],
  ['forward', ArrowUpToLine, 'Bring forward', 'Avançar'],
  ['backward', ArrowDownToLine, 'Send backward', 'Recuar'],
  ['back', SendToBack, 'Send to back', 'Enviar para trás'],
];

function allIds(content: SlidesContent): string[] {
  return content.slides.flatMap((slide) => [slide.id, ...slide.elements.map((element) => element.id)]);
}

/**
 * Visual slide editor built on the read-only renderer (what you edit is what you export). Every interaction
 * becomes kind operations through `emit`; gestures emit one operation at the end (spec §11.3, §13.6).
 */
export function SlidesEditor({
  content,
  ctx,
  emit,
  readOnly,
  lint = [],
  layouts = builtInLayouts,
  uploadImage,
  allowHexColors = false,
  gridSize = 0.25,
  initialSlideId,
  className,
}: SlidesEditorProps): ReactElement {
  const t = (en: string, pt: string) => tr(ctx.locale, en, pt);
  const [currentId, setCurrentId] = useState<string | undefined>(initialSlideId ?? content.slides[0]?.id);
  const [selection, setSelection] = useState<Selection>({ kind: 'none' });
  const [editing, setEditing] = useState<TextTarget | undefined>(undefined);
  const [gridOn, setGridOn] = useState(false);
  const [presenting, setPresenting] = useState(false);
  const [clipboard, setClipboard] = useState<string | undefined>(undefined);
  const inserts = useRef(0);
  const imageInput = useRef<HTMLInputElement>(null);

  const index = Math.max(
    0,
    content.slides.findIndex((slide) => slide.id === currentId),
  );
  const slide = content.slides[index];
  const layout = slide ? resolveLayout(layouts, slide.layout, Object.keys(slide.slots)) : undefined;

  // Keep the current slide and the selection valid when the content changes (agent edits, undo, removal).
  useEffect(() => {
    if (!content.slides.some((item) => item.id === currentId))
      setCurrentId(content.slides[Math.min(index, content.slides.length - 1)]?.id);
  }, [content.slides, currentId, index]);
  useEffect(() => {
    if (selection.kind !== 'elements' || !slide) return;
    const alive = selection.ids.filter((id) => slide.elements.some((element) => element.id === id));
    if (alive.length !== selection.ids.length)
      setSelection(alive.length > 0 ? { kind: 'elements', ids: alive } : { kind: 'none' });
  }, [slide, selection]);

  const env: EditorEnv = useMemo(
    () => ({
      ctx,
      emit,
      readOnly,
      allowHexColors,
      ...(uploadImage ? { uploadImage } : {}),
      lint,
      t: (en: string, pt: string) => tr(ctx.locale, en, pt),
    }),
    [ctx, emit, readOnly, allowHexColors, uploadImage, lint],
  );

  const selectSlide = (id: string) => {
    setCurrentId(id);
    setSelection({ kind: 'none' });
    setEditing(undefined);
  };

  // Ids are chosen here (with the same allocator the engine uses) so the new item can be selected at once.
  const insertElement = (element: ElementInput) => {
    if (!slide || readOnly) return;
    const id = new IdAllocator(allIds(content)).next(ELEMENT_ID_PREFIX[element.type]);
    emit([{ op: 'add_element', slide: slide.id, element: { ...element, id } }]);
    setSelection({ kind: 'elements', ids: [id] });
    if (element.type === 'text') setEditing({ kind: 'element', id });
  };
  const insert = (kind: InsertKind) => {
    const offset = (inserts.current++ % 5) * 0.2;
    insertElement(newElement(kind, { text: t('Text', 'Texto'), series: t('Series 1', 'Série 1') }, offset));
  };
  const insertSlide = (layoutName: string) => {
    const id = new IdAllocator(allIds(content)).next('s');
    emit([
      {
        op: 'add_slide',
        ...(slide ? { after: slide.id } : {}),
        slide: { id, layout: layoutName, slots: {}, elements: [] },
      },
    ]);
    selectSlide(id);
  };

  const selectedIds = selection.kind === 'elements' ? selection.ids : [];
  const hasSelection = selectedIds.length > 0;
  const swatches = themeSwatches(ctx.theme, ctx.locale);
  const insertChart = (chartType: (typeof CHART_TYPES)[number]) => {
    const offset = (inserts.current++ % 5) * 0.2;
    const element = newElement(
      'chart',
      { text: t('Text', 'Texto'), series: t('Series 1', 'Série 1') },
      offset,
    );
    insertElement({ ...element, chartType } as ElementInput);
  };
  const copy = () => {
    if (!slide || !hasSelection) return;
    const text = serializeElements(slide, selectedIds);
    setClipboard(text);
    void globalThis.navigator?.clipboard?.writeText(text).catch(() => {});
  };
  const paste = () => {
    const elements = clipboard ? parseClipboard(clipboard) : undefined;
    if (!slide || readOnly || !elements?.length) return;
    const result = cloneElementsOps(content, slide.id, elements);
    emit(result.operations);
    setSelection({ kind: 'elements', ids: result.select });
  };
  const cut = () => {
    if (readOnly || !hasSelection) return;
    copy();
    emit(deleteOps(selectedIds));
    setSelection({ kind: 'none' });
  };
  const duplicate = () => {
    if (!slide || readOnly || !hasSelection) return;
    const result = duplicateOps(content, slide, selectedIds);
    emit(result.operations);
    setSelection({ kind: 'elements', ids: result.select });
  };

  return (
    <div className={`ak-slides-editor ak-ctl-scope${className ? ` ${className}` : ''}`}>
      <Toolbar label={t('Slide editor', 'Editor de slides')} className="ak-slides-editor-toolbar">
        <ToolbarGroup label={t('Slide', 'Slide')}>
          <ToolbarMenu
            icon={Plus}
            label={t('New slide', 'Novo slide')}
            showLabel
            disabled={readOnly}
            items={layouts.list().map((item) => ({
              key: item.name,
              label: item.label,
              icon: LayoutTemplate,
              onSelect: () => insertSlide(item.name),
            }))}
          />
          {slide && layout ? (
            <ToolbarSelect
              label={t('Layout', 'Layout')}
              value={slide.layout}
              options={layouts.list().map((item) => ({ value: item.name, label: item.label }))}
              disabled={readOnly}
              onChange={(name) => emit([{ op: 'set_layout', slide: slide.id, layout: name }])}
              width={150}
            />
          ) : null}
          <ToolbarColor
            icon={PaintBucket}
            label={t('Background', 'Fundo')}
            value={slide?.background?.color ?? null}
            colors={swatches}
            noneLabel={t('Default', 'Padrão')}
            disabled={readOnly || !slide}
            onChange={(color) =>
              slide &&
              emit([
                {
                  op: 'set_background',
                  slide: slide.id,
                  background:
                    color || slide.background?.image
                      ? {
                          ...(color ? { color } : {}),
                          ...(slide.background?.image ? { image: slide.background.image } : {}),
                        }
                      : null,
                },
              ])
            }
          />
          <ToolbarButton
            icon={CopyPlus}
            label={t('Duplicate slide', 'Duplicar slide')}
            disabled={readOnly || !slide}
            onClick={() => slide && emit([{ op: 'duplicate_slide', slide: slide.id }])}
          />
        </ToolbarGroup>
        <ToolbarGroup label={t('Insert', 'Inserir')}>
          <ToolbarButton
            icon={Type}
            label={t('Text box', 'Caixa de texto')}
            disabled={readOnly || !slide}
            onClick={() => insert('text')}
          />
          <ToolbarMenu
            icon={Shapes}
            label={t('Shape', 'Forma')}
            disabled={readOnly || !slide}
            items={SHAPES.map(([kind, Icon, en, pt]) => ({
              key: kind,
              label: t(en, pt),
              icon: Icon,
              onSelect: () => insert(kind),
            }))}
          />
          {uploadImage ? (
            <ToolbarButton
              icon={ImageIcon}
              label={t('Image', 'Imagem')}
              disabled={readOnly || !slide}
              onClick={() => imageInput.current?.click()}
            />
          ) : null}
          <ToolbarButton
            icon={Table}
            label={t('Table', 'Tabela')}
            disabled={readOnly || !slide}
            onClick={() => insert('table')}
          />
          <ToolbarMenu
            icon={ChartColumn}
            label={t('Chart', 'Gráfico')}
            disabled={readOnly || !slide}
            items={CHARTS.map(([chartType, Icon, en, pt]) => ({
              key: chartType,
              label: t(en, pt),
              icon: Icon,
              onSelect: () => insertChart(chartType),
            }))}
          />
        </ToolbarGroup>
        <ToolbarGroup label={t('Arrange', 'Organizar')}>
          <ToolbarButton
            icon={Copy}
            label={t('Copy', 'Copiar')}
            shortcut="Ctrl+C"
            disabled={!hasSelection}
            onClick={copy}
          />
          <ToolbarButton
            icon={Scissors}
            label={t('Cut', 'Recortar')}
            shortcut="Ctrl+X"
            disabled={readOnly || !hasSelection}
            onClick={cut}
          />
          <ToolbarButton
            icon={ClipboardPaste}
            label={t('Paste', 'Colar')}
            shortcut="Ctrl+V"
            disabled={readOnly || !slide || !clipboard}
            onClick={paste}
          />
          <ToolbarButton
            icon={CopyPlus}
            label={t('Duplicate', 'Duplicar')}
            shortcut="Ctrl+D"
            disabled={readOnly || !hasSelection}
            onClick={duplicate}
          />
          <ToolbarMenu
            icon={AlignHorizontalJustifyCenter}
            label={t('Align', 'Alinhar')}
            disabled={readOnly || !hasSelection}
            items={[
              ...ALIGNS.map(([mode, Icon, en, pt]) => ({
                key: mode,
                label: t(en, pt),
                icon: Icon,
                onSelect: () => slide && emit(alignOps(slide, selectedIds, mode)),
              })),
              'separator' as const,
              {
                key: 'h',
                label: t('Distribute horizontally', 'Distribuir na horizontal'),
                icon: AlignHorizontalSpaceAround,
                disabled: selectedIds.length < 3,
                onSelect: () => slide && emit(distributeOps(slide, selectedIds, 'horizontal')),
              },
              {
                key: 'v',
                label: t('Distribute vertically', 'Distribuir na vertical'),
                icon: AlignVerticalSpaceAround,
                disabled: selectedIds.length < 3,
                onSelect: () => slide && emit(distributeOps(slide, selectedIds, 'vertical')),
              },
            ]}
          />
          <ToolbarMenu
            icon={Layers}
            label={t('Order', 'Ordem')}
            disabled={readOnly || !hasSelection}
            items={ORDERS.map(([to, Icon, en, pt]) => ({
              key: to,
              label: t(en, pt),
              icon: Icon,
              onSelect: () => slide && emit(reorderOps(slide, selectedIds, to)),
            }))}
          />
          <ToolbarButton
            icon={Trash2}
            label={t('Delete', 'Excluir')}
            shortcut="Del"
            variant="danger"
            disabled={readOnly || !hasSelection}
            onClick={() => {
              emit(deleteOps(selectedIds));
              setSelection({ kind: 'none' });
            }}
          />
        </ToolbarGroup>
        <ToolbarGroup label={t('View', 'Exibição')}>
          <ToolbarButton
            icon={Grid3x3}
            label={t('Snap to grid', 'Encaixar na grade')}
            pressed={gridOn}
            onClick={() => setGridOn(!gridOn)}
          />
          <ToolbarButton
            icon={Presentation}
            label={t('Present', 'Apresentar')}
            showLabel
            variant="primary"
            disabled={content.slides.length === 0}
            onClick={() => setPresenting(true)}
            keepFocus={false}
          />
        </ToolbarGroup>
      </Toolbar>
      {uploadImage ? (
        <input
          ref={imageInput}
          type="file"
          accept="image/png,image/jpeg,image/gif,image/webp,image/svg+xml"
          hidden
          onChange={async (event) => {
            const file = event.target.files?.[0];
            event.target.value = '';
            if (!file) return;
            const result = await uploadImage(file);
            insertElement(
              newImageElement(result.asset, result.alt ?? file.name, (inserts.current++ % 5) * 0.2),
            );
          }}
        />
      ) : null}
      <div className="ak-slides-editor-body">
        <SlidePanel
          env={env}
          content={content}
          layouts={layouts}
          currentId={slide?.id}
          onSelect={selectSlide}
          onInsert={insertSlide}
        />
        <div className="ak-slides-editor-main">
          {slide && layout ? (
            <>
              <EditCanvas
                env={env}
                slide={slide}
                slideNumber={index + 1}
                {...(content.footer ? { footer: content.footer } : {})}
                layouts={layouts}
                layout={layout}
                selection={selection}
                onSelect={(next) => {
                  setSelection(next);
                  setEditing(undefined);
                }}
                editing={editing}
                onEdit={setEditing}
                {...(gridOn ? { grid: gridSize } : {})}
                onCopy={copy}
                onCut={cut}
                onPaste={paste}
                onDuplicate={duplicate}
              />
              <TextField
                label={t('Speaker notes', 'Notas do apresentador')}
                value={slide.notes ?? ''}
                multiline
                disabled={readOnly}
                onCommit={(notes) => emit([{ op: 'set_notes', slide: slide.id, notes }], { kind: 'typing' })}
              />
            </>
          ) : (
            <p className="ak-slides-notes-empty">
              {t('No slides yet. Add one from the panel.', 'Ainda não há slides. Adicione um pelo painel.')}
            </p>
          )}
        </div>
        <aside className="ak-ctl-inspector ak-slides-inspector" aria-label={t('Properties', 'Propriedades')}>
          {slide && layout ? (
            <Inspector
              env={env}
              slide={slide}
              layout={layout}
              layouts={layouts}
              selection={selection}
              onSelect={setSelection}
              onEditText={(target) => {
                if (target.kind === 'slot') setSelection({ kind: 'slot', slot: target.slot });
                setEditing(target);
              }}
            />
          ) : null}
          <section className="ak-ctl-section" aria-label={t('Deck', 'Deck')}>
            <h3 className="ak-ctl-section-title">{t('Deck footer', 'Rodapé do deck')}</h3>
            <TextField
              label={t('Footer text', 'Texto do rodapé')}
              value={content.footer?.text ?? ''}
              disabled={readOnly}
              onCommit={(text) =>
                emit([
                  {
                    op: 'set_footer',
                    footer: {
                      ...(text ? { text } : {}),
                      ...(content.footer?.slideNumber ? { slideNumber: true } : {}),
                    },
                  },
                ])
              }
            />
            <Toggle
              label={t('Slide numbers', 'Números de slide')}
              pressed={!!content.footer?.slideNumber}
              disabled={readOnly}
              onChange={(slideNumber) =>
                emit([
                  {
                    op: 'set_footer',
                    footer: {
                      ...(content.footer?.text ? { text: content.footer.text } : {}),
                      ...(slideNumber ? { slideNumber } : {}),
                    },
                  },
                ])
              }
            />
          </section>
        </aside>
      </div>
      {presenting ? (
        <SlidesPresentation
          content={content}
          ctx={ctx}
          layouts={layouts}
          {...(slide ? { startSlideId: slide.id } : {})}
          onExit={() => setPresenting(false)}
        />
      ) : null}
    </div>
  );
}
