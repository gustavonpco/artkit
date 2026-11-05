import type { RenderContext } from '@artkit-ai/core';
import { Renderer } from '@openuidev/react-lang';
import { uiReactLibrary } from './components.js';
import { componentsCss } from './css.js';

export interface OpenUIRendererProps {
  content: string;
  ctx: RenderContext;
  className?: string;
}

/** Renders OpenUI Lang with the artkit component library, streaming when the content is provisional. */
export function OpenUIRenderer({ content, ctx, className }: OpenUIRendererProps) {
  return (
    <div className={`ak-visual${className ? ` ${className}` : ''}`} data-mode={ctx.mode}>
      <Renderer response={content} library={uiReactLibrary} isStreaming={Boolean(ctx.provisional)} />
    </div>
  );
}

export { componentsCss, uiReactLibrary };
