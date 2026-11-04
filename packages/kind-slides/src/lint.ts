import {
  type Color,
  contrastRatio,
  type LintContext,
  type LintIssue,
  resolveColor,
  type Theme,
} from '@artkit/core';
import {
  composeSlide,
  DEFAULT_SHAPE_TEXT_STYLE,
  elementPlainText,
  type Primitive,
  resolveTextStyle,
} from './compose.js';
import { tableColumnWidths, textElementParagraphs } from './elements.js';
import { containsRect, intersectionArea, type Rect } from './geometry.js';
import { tr } from './i18n.js';
import { isTitleRole, type LayoutRegistry } from './layouts.js';
import type { Slide, SlidesContent } from './schema.js';
import { normalizeParagraphs } from './text.js';
import { estimateTableHeight, estimateTextFit, OVERFLOW_TOLERANCE } from './text-metrics.js';

/** Bullets per text box above which the slide gets a warning (one idea per slide). */
export const MAX_BULLETS = 6;
/** WCAG AA contrast for normal and large text. */
export const MIN_CONTRAST = 4.5;
export const MIN_CONTRAST_LARGE = 3;

export const LINT_CODES = [
  'text-overflow',
  'table-overflow',
  'overlap',
  'low-contrast',
  'missing-title',
  'empty-slot',
  'too-many-bullets',
  'missing-alt',
] as const;

export type SlidesLintCode = (typeof LINT_CODES)[number];

/** Lint target for a primitive: `element:<id>` for free elements, `slot:<slideId>.<slot>` for slots. */
export function primitiveTarget(slideId: string, primitive: Primitive): string | undefined {
  if (primitive.source.kind === 'element') return `element:${primitive.source.id}`;
  if (primitive.source.kind === 'slot') return `slot:${slideId}.${primitive.source.slot}`;
  return undefined;
}

function fontFamily(theme: Theme, role: 'heading' | 'body' | 'mono'): string {
  return theme.fonts[role];
}

function where(target: string, locale: string): string {
  if (target.startsWith('slot:'))
    return tr(locale, `Slot [${target.split('.').pop()}]`, `Slot [${target.split('.').pop()}]`);
  return tr(
    locale,
    `Element ${target.slice('element:'.length)}`,
    `Elemento ${target.slice('element:'.length)}`,
  );
}

/** Background color behind a rect: the topmost filled shape below it that contains it, else the slide. */
function backgroundBehind(
  primitives: Primitive[],
  index: number,
  rect: Rect,
  slideBackground: Color | undefined,
): Color | undefined {
  for (let i = index - 1; i >= 0; i--) {
    const below = primitives[i]!.element;
    if (below.type === 'image' && containsRect(below, rect)) return undefined;
    if (
      below.type === 'shape' &&
      below.fill &&
      below.shape !== 'line' &&
      below.shape !== 'arrow' &&
      containsRect(below, rect)
    )
      return below.fill;
    if (below.type === 'text' && below.fill && containsRect(below, rect)) return below.fill;
  }
  return slideBackground;
}

export function lintSlides(content: SlidesContent, ctx: LintContext, layouts: LayoutRegistry): LintIssue[] {
  const issues: LintIssue[] = [];
  const seen = new Set<string>();
  const { locale, theme } = ctx;
  const push = (issue: LintIssue) => {
    const key = `${issue.code}|${issue.target}`;
    if (seen.has(key)) return;
    seen.add(key);
    issues.push(issue);
  };
  for (const [slideIndex, slide] of content.slides.entries()) {
    lintSlide(slide, slideIndex, content, layouts, theme, locale, push);
  }
  return issues;
}

function lintSlide(
  slide: Slide,
  slideIndex: number,
  content: SlidesContent,
  layouts: LayoutRegistry,
  theme: Theme,
  locale: string,
  push: (issue: LintIssue) => void,
): void {
  const composed = composeSlide(slide, {
    layouts,
    ...(content.footer ? { footer: content.footer } : {}),
    slideNumber: slideIndex + 1,
  });
  const slideTarget = `slide:${slide.id}`;
  const slideBackground = composed.background.image ? undefined : composed.background.color;

  // Missing title and empty required slots.
  const titleSlot = composed.layout.slots.find((slot) => isTitleRole(slot.role));
  if (titleSlot) {
    const value = slide.slots[titleSlot.name];
    const empty = value === undefined || (typeof value === 'string' && value.trim() === '');
    if (empty) {
      push({
        code: 'missing-title',
        severity: 'warning',
        target: slideTarget,
        message: tr(
          locale,
          `Slide ${slideIndex + 1} has no title.`,
          `O slide ${slideIndex + 1} não tem título.`,
        ),
        hint: tr(
          locale,
          `Fill slot "${titleSlot.name}" with a short assertion.`,
          `Preencha o slot "${titleSlot.name}" com uma afirmação curta.`,
        ),
      });
    }
  } else if (
    composed.layout.name === 'blank' &&
    !slide.elements.some((element) => element.type === 'text' && (element.fontSize ?? 18) >= 24)
  ) {
    push({
      code: 'missing-title',
      severity: 'info',
      target: slideTarget,
      message: tr(
        locale,
        `Blank slide ${slideIndex + 1} has no visible title.`,
        `O slide em branco ${slideIndex + 1} não tem título visível.`,
      ),
      hint: tr(
        locale,
        'Add a text element of 24pt or more at the top, or use a layout with a title.',
        'Adicione um texto de 24pt ou mais no topo, ou use um layout com título.',
      ),
    });
  }
  for (const { slot, content: value } of composed.slots) {
    if (!slot.required || isTitleRole(slot.role) || value !== undefined) continue;
    push({
      code: 'empty-slot',
      severity: 'warning',
      target: `slot:${slide.id}.${slot.name}`,
      message: tr(
        locale,
        `Slot [${slot.name}] of slide ${slideIndex + 1} is empty.`,
        `O slot [${slot.name}] do slide ${slideIndex + 1} está vazio.`,
      ),
      hint: tr(
        locale,
        `Fill it with set_slot (accepts: ${slot.accepts.join(', ')}) or change the layout.`,
        `Preencha com set_slot (aceita: ${slot.accepts.join(', ')}) ou troque o layout.`,
      ),
    });
  }

  composed.primitives.forEach((primitive, index) => {
    const target = primitiveTarget(slide.id, primitive);
    if (!target) return;
    const element = primitive.element;
    const text =
      element.type === 'text'
        ? { paragraphs: textElementParagraphs(element), style: resolveTextStyle(element), fill: element.fill }
        : element.type === 'shape' && element.text
          ? {
              paragraphs: normalizeParagraphs(element.text.paragraphs),
              style: resolveTextStyle(element.text, DEFAULT_SHAPE_TEXT_STYLE),
              fill: element.fill,
            }
          : undefined;
    if (text) {
      const fit = estimateTextFit({
        paragraphs: text.paragraphs,
        fontSize: text.style.fontSize,
        fontFamily: fontFamily(theme, text.style.font),
        bold: text.style.bold,
        width: element.w,
        height: element.h,
      });
      if (!fit.fits && text.paragraphs.some((p) => p.runs.some((run) => run.text.trim()))) {
        push({
          code: 'text-overflow',
          severity: 'warning',
          target,
          message: tr(
            locale,
            `${where(target, locale)} on slide ${slideIndex + 1}: text needs about ${fit.height.toFixed(1)} in and the box has ${fit.available.toFixed(1)} in.`,
            `${where(target, locale)} no slide ${slideIndex + 1}: o texto precisa de cerca de ${fit.height.toFixed(1)} pol e a caixa tem ${fit.available.toFixed(1)} pol.`,
          ),
          hint: tr(
            locale,
            'Shorten the text, split it into another slide, reduce the font size or enlarge the box.',
            'Encurte o texto, divida em outro slide, reduza a fonte ou aumente a caixa.',
          ),
        });
      }
      const bullets = text.paragraphs.filter((p) => p.list).length;
      if (bullets > MAX_BULLETS) {
        push({
          code: 'too-many-bullets',
          severity: 'warning',
          target,
          message: tr(
            locale,
            `${where(target, locale)} on slide ${slideIndex + 1} has ${bullets} bullets.`,
            `${where(target, locale)} no slide ${slideIndex + 1} tem ${bullets} marcadores.`,
          ),
          hint: tr(
            locale,
            `Keep at most ${MAX_BULLETS} bullets: one idea per slide, details in the notes.`,
            `Use no máximo ${MAX_BULLETS} marcadores: uma ideia por slide, detalhes nas notas.`,
          ),
        });
      }
      const background = text.fill ?? backgroundBehind(composed.primitives, index, element, slideBackground);
      if (background) {
        const bg = resolveColor(theme, background, 'background');
        const colors = new Set<Color>([
          text.style.color,
          ...text.paragraphs.flatMap((p) => p.runs.flatMap((run) => (run.color ? [run.color] : []))),
        ]);
        const large = text.style.fontSize >= 24 || (text.style.bold && text.style.fontSize >= 18.66);
        const minimum = large ? MIN_CONTRAST_LARGE : MIN_CONTRAST;
        for (const color of colors) {
          const ratio = contrastRatio(resolveColor(theme, color), bg);
          if (ratio < minimum) {
            push({
              code: 'low-contrast',
              severity: 'warning',
              target,
              message: tr(
                locale,
                `${where(target, locale)} on slide ${slideIndex + 1}: contrast ${ratio.toFixed(1)}:1 between "${color}" and the background is below ${minimum}:1.`,
                `${where(target, locale)} no slide ${slideIndex + 1}: contraste ${ratio.toFixed(1)}:1 entre "${color}" e o fundo está abaixo de ${minimum}:1.`,
              ),
              hint: tr(
                locale,
                'Use the "text" token on light backgrounds or "background" on dark fills.',
                'Use o token "text" em fundos claros ou "background" em preenchimentos escuros.',
              ),
            });
            break;
          }
        }
      }
    }
    if (element.type === 'table') {
      const widths = tableColumnWidths(element, element.w);
      const rows = [...(element.header ? [element.header] : []), ...element.rows];
      const height = estimateTableHeight({
        rows,
        widths,
        fontSize: element.fontSize ?? 14,
        fontFamily: theme.fonts.body,
        headerRows: element.header ? 1 : 0,
      });
      if (height > element.h * OVERFLOW_TOLERANCE) {
        push({
          code: 'table-overflow',
          severity: 'warning',
          target,
          message: tr(
            locale,
            `${where(target, locale)} on slide ${slideIndex + 1}: the table needs about ${height.toFixed(1)} in and the box has ${element.h.toFixed(1)} in.`,
            `${where(target, locale)} no slide ${slideIndex + 1}: a tabela precisa de cerca de ${height.toFixed(1)} pol e a caixa tem ${element.h.toFixed(1)} pol.`,
          ),
          hint: tr(
            locale,
            'Split the table across slides, remove rows or reduce fontSize.',
            'Divida a tabela em slides, remova linhas ou reduza fontSize.',
          ),
        });
      }
    }
    if (element.type === 'image' && element.alt.trim() === '') {
      push({
        code: 'missing-alt',
        severity: 'warning',
        target,
        message: tr(
          locale,
          `${where(target, locale)} on slide ${slideIndex + 1}: image without alternative text.`,
          `${where(target, locale)} no slide ${slideIndex + 1}: imagem sem texto alternativo.`,
        ),
        hint: tr(locale, 'Describe the image in "alt".', 'Descreva a imagem em "alt".'),
      });
    }
  });

  lintOverlaps(slide, slideIndex, composed.primitives, locale, push);
}

interface Occupant {
  target: string;
  label: string;
  rect: Rect;
  type: string;
  element: boolean;
}

function lintOverlaps(
  slide: Slide,
  slideIndex: number,
  primitives: Primitive[],
  locale: string,
  push: (issue: LintIssue) => void,
): void {
  const occupants: Occupant[] = [];
  const slotBoxes = new Map<string, Rect>();
  for (const primitive of primitives) {
    if (primitive.source.kind === 'slot') {
      const current = slotBoxes.get(primitive.source.slot);
      const r = primitive.element;
      slotBoxes.set(
        primitive.source.slot,
        current
          ? {
              x: Math.min(current.x, r.x),
              y: Math.min(current.y, r.y),
              w: Math.max(current.x + current.w, r.x + r.w) - Math.min(current.x, r.x),
              h: Math.max(current.y + current.h, r.y + r.h) - Math.min(current.y, r.y),
            }
          : { x: r.x, y: r.y, w: r.w, h: r.h },
      );
    }
  }
  for (const [slot, rect] of slotBoxes)
    occupants.push({
      target: `slot:${slide.id}.${slot}`,
      label: `[${slot}]`,
      rect,
      type: 'slot',
      element: false,
    });
  for (const element of slide.elements) {
    // Shapes are containers and decoration: text on a card is intended.
    if (element.type === 'shape') continue;
    occupants.push({
      target: `element:${element.id}`,
      label: `${element.id} "${elementPlainText(element).slice(0, 30)}"`,
      rect: element,
      type: element.type,
      element: true,
    });
  }
  for (let i = 0; i < occupants.length; i++) {
    const front = occupants[i]!;
    if (!front.element) continue;
    for (let j = 0; j < occupants.length; j++) {
      if (i === j) continue;
      const other = occupants[j]!;
      // Each pair once: elements are compared with earlier elements and with every slot.
      if (other.element && j > i) continue;
      const area = intersectionArea(front.rect, other.rect);
      const smaller = Math.min(front.rect.w * front.rect.h, other.rect.w * other.rect.h);
      if (area <= 0.02 || area <= smaller * 0.05) continue;
      // A caption laid over an image is intentional.
      if (
        (front.type === 'text' && other.type === 'image' && containsRect(other.rect, front.rect)) ||
        (other.type === 'text' && front.type === 'image' && containsRect(front.rect, other.rect))
      )
        continue;
      push({
        code: 'overlap',
        severity: 'warning',
        target: front.target,
        message: tr(
          locale,
          `Element ${front.target.slice('element:'.length)} on slide ${slideIndex + 1} overlaps ${other.element ? `element ${other.label}` : `slot ${other.label}`}.`,
          `O elemento ${front.target.slice('element:'.length)} no slide ${slideIndex + 1} sobrepõe ${other.element ? `o elemento ${other.label}` : `o slot ${other.label}`}.`,
        ),
        hint: tr(
          locale,
          'Move or resize it, or put it on a shape if the layering is intended.',
          'Mova ou redimensione, ou coloque sobre uma forma se a sobreposição for intencional.',
        ),
      });
      break;
    }
  }
}
