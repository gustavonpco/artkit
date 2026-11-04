import type { RenderContext } from '@artkit/core';
import type { CSSProperties, ReactElement, ReactNode } from 'react';
import { composeSlide, slideTitle } from '../compose.js';
import { builtInLayouts, type LayoutRegistry } from '../layouts.js';
import type { Footer, Slide } from '../schema.js';
import { PrimitiveView } from './Primitives.js';
import { colorCss } from './style.js';

export interface SlideViewProps {
  slide: Slide;
  ctx: RenderContext;
  /** Layouts of the kind (`slidesKind.layouts`); defaults to the built-ins. */
  layouts?: LayoutRegistry;
  footer?: Footer;
  /** 1-based position, used for the slide number and the accessible label. */
  slideNumber?: number;
  className?: string;
  /** Extra layers drawn above the slide content (editor overlays). */
  children?: ReactNode;
  /** Decorative copies (thumbnails) are hidden from assistive technology. */
  decorative?: boolean;
}

/**
 * One slide on a responsive canvas: fixed 16:9 aspect ratio, positions in percent and font sizes in
 * container query units, so the drawing scales exactly at any width (spec §11.3).
 */
export function SlideView({
  slide,
  ctx,
  layouts = builtInLayouts,
  footer,
  slideNumber = 1,
  className,
  children,
  decorative,
}: SlideViewProps): ReactElement {
  const composed = composeSlide(slide, { layouts, ...(footer ? { footer } : {}), slideNumber });
  const background = composed.background;
  const fill = colorCss(ctx.theme, background.color);
  // The slide fill is also exposed as a variable so editing overlays can match it.
  const style = { background: fill, '--ak-slides-bg': fill } as CSSProperties;
  const image = background.image ? ctx.resolveAssetUrl?.(background.image) : undefined;
  if (image) {
    style.backgroundImage = `url("${image.replace(/"/g, '%22')}")`;
    style.backgroundSize = 'cover';
    style.backgroundPosition = 'center';
  }
  const title = slideTitle(slide, layouts);
  return (
    <div
      className={`ak-slides-slide${slide.hidden ? ' ak-slides-hidden' : ''}${ctx.provisional ? ' ak-slides-provisional' : ''}${className ? ` ${className}` : ''}`}
      style={style}
      data-slide-id={slide.id}
      {...(decorative
        ? { 'aria-hidden': true }
        : {
            role: 'group',
            'aria-roledescription': 'slide',
            'aria-label': `${slideNumber}${title ? `: ${title}` : ''}`,
          })}
    >
      {composed.primitives.map((primitive) => (
        <PrimitiveView key={primitive.element.id} primitive={primitive} ctx={ctx} />
      ))}
      {children}
    </div>
  );
}
